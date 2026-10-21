"""
Suraksha Grid — Spatial Matching Service
=========================================
Accurate geometric matching of ORS route polylines to road segments.
Replaces bounding-box proximity with precise line-to-polyline corridor matching.

Coordinates are [longitude, latitude] (WGS-84 / EPSG:4326).
"""
from __future__ import annotations

import math
from typing import Any, Optional
from app.services.safety_engine import SegmentForScoring

# Default tolerance in meters for matching a road segment to a route polyline
DEFAULT_DISTANCE_TOLERANCE_METERS = 30.0


def _to_meters(coord: list[float], ref_lat_rad: float) -> tuple[float, float]:
    """Convert [lng, lat] in degrees to metric (x, y) coordinates."""
    lng, lat = coord[0], coord[1]
    x = lng * 111320.0 * math.cos(ref_lat_rad)
    y = lat * 110540.0
    return x, y


def _haversine_km(c1: list[float], c2: list[float]) -> float:
    """Great-circle distance between two [lng, lat] points in km."""
    lng1, lat1 = c1[0], c1[1]
    lng2, lat2 = c2[0], c2[1]
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2.0) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(max(0.0, a)), math.sqrt(max(0.0, 1.0 - a)))
    return r * c


def compute_linestring_length_km(coords: list[list[float]]) -> float:
    """Calculate the total length of a LineString in kilometers."""
    if not coords or len(coords) < 2:
        return 0.05
    total = 0.0
    for i in range(len(coords) - 1):
        total += _haversine_km(coords[i], coords[i + 1])
    return max(0.05, total)


def _point_to_line_segment_dist_sq(
    px: float, py: float,
    ax: float, ay: float,
    bx: float, by: float,
) -> float:
    """Squared distance from point P to line segment AB in meters."""
    dx = bx - ax
    dy = by - ay
    l2 = dx * dx + dy * dy
    if l2 == 0.0:
        return (px - ax) ** 2 + (py - ay) ** 2

    # Clamp projection parameter t to [0, 1]
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
    proj_x = ax + t * dx
    proj_y = ay + t * dy
    return (px - proj_x) ** 2 + (py - proj_y) ** 2


def point_to_polyline_dist_meters(
    point: list[float],
    polyline: list[list[float]],
) -> float:
    """Minimum distance from a point [lng, lat] to a polyline in meters."""
    if not polyline or len(polyline) < 2:
        return float("inf")

    ref_lat = math.radians(point[1])
    px, py = _to_meters(point, ref_lat)

    min_dist_sq = float("inf")
    for i in range(len(polyline) - 1):
        ax, ay = _to_meters(polyline[i], ref_lat)
        bx, by = _to_meters(polyline[i + 1], ref_lat)
        d_sq = _point_to_line_segment_dist_sq(px, py, ax, ay, bx, by)
        if d_sq < min_dist_sq:
            min_dist_sq = d_sq
            if min_dist_sq == 0.0:
                break

    return math.sqrt(min_dist_sq)


def _extract_coords(geometry: Optional[dict[str, Any]]) -> list[list[float]]:
    """Extract coordinates from a GeoJSON geometry object safely."""
    if not geometry or not isinstance(geometry, dict):
        return []

    gtype = geometry.get("type")
    raw_coords = geometry.get("coordinates")
    if not raw_coords or not isinstance(raw_coords, list):
        return []

    coords: list[list[float]] = []
    if gtype == "LineString":
        for pt in raw_coords:
            if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                try:
                    coords.append([float(pt[0]), float(pt[1])])
                except (ValueError, TypeError):
                    continue
    elif gtype == "MultiLineString":
        for line in raw_coords:
            if isinstance(line, list):
                for pt in line:
                    if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                        try:
                            coords.append([float(pt[0]), float(pt[1])])
                        except (ValueError, TypeError):
                            continue
    return coords


def _bbox(coords: list[list[float]]) -> tuple[float, float, float, float]:
    """Return (min_lng, min_lat, max_lng, max_lat)."""
    lngs = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return min(lngs), min(lats), max(lngs), max(lats)


def is_segment_on_route(
    seg_coords: list[list[float]],
    route_coords: list[list[float]],
    tolerance_meters: float = DEFAULT_DISTANCE_TOLERANCE_METERS,
) -> bool:
    """
    Determine whether a road segment follows/lies along the route corridor.
    A segment is matched if its vertices and midpoint lie within tolerance of the route.
    """
    if len(seg_coords) < 2 or len(route_coords) < 2:
        return False

    # Fast bounding box overlap check with tolerance buffer in degrees (~0.001 deg ≈ 110m)
    buf_deg = (tolerance_meters + 50.0) / 111000.0
    r_min_lng, r_min_lat, r_max_lng, r_max_lat = _bbox(route_coords)
    s_min_lng, s_min_lat, s_max_lng, s_max_lat = _bbox(seg_coords)

    if (
        s_max_lng < r_min_lng - buf_deg
        or s_min_lng > r_max_lng + buf_deg
        or s_max_lat < r_min_lat - buf_deg
        or s_min_lat > r_max_lat + buf_deg
    ):
        return False

    # Check key points along segment: start, end, and midpoint(s)
    test_points: list[list[float]] = [seg_coords[0], seg_coords[-1]]
    if len(seg_coords) > 2:
        mid_idx = len(seg_coords) // 2
        test_points.append(seg_coords[mid_idx])
    else:
        # Interpolate midpoint of segment
        test_points.append([
            (seg_coords[0][0] + seg_coords[1][0]) / 2.0,
            (seg_coords[0][1] + seg_coords[1][1]) / 2.0,
        ])

    # For a segment to follow the route, the majority of its key points must be within tolerance
    close_count = 0
    for pt in test_points:
        dist = point_to_polyline_dist_meters(pt, route_coords)
        if dist <= tolerance_meters:
            close_count += 1

    # At least 2 of 3 test points (or > 50%) must be within tolerance
    return close_count >= math.ceil(len(test_points) / 2.0)


def match_road_segments(
    route_coords: list[list[float]],
    all_segments: list[dict[str, Any]],
    tolerance_meters: float = DEFAULT_DISTANCE_TOLERANCE_METERS,
) -> list[SegmentForScoring]:
    """
    Match road segments against actual route geometry using defensible distance tolerance.
    Returns matched segments as SegmentForScoring objects with length in km.
    """
    if not route_coords or len(route_coords) < 2:
        return []

    # Filter out malformed route coordinates
    valid_route: list[list[float]] = []
    for pt in route_coords:
        if isinstance(pt, (list, tuple)) and len(pt) >= 2:
            try:
                valid_route.append([float(pt[0]), float(pt[1])])
            except (ValueError, TypeError):
                continue

    if len(valid_route) < 2:
        return []

    matched: list[SegmentForScoring] = []

    for seg in all_segments:
        geo = seg.get("geometry")
        seg_coords = _extract_coords(geo)
        if len(seg_coords) < 2:
            continue

        if is_segment_on_route(seg_coords, valid_route, tolerance_meters=tolerance_meters):
            length_km = compute_linestring_length_km(seg_coords)
            matched.append(SegmentForScoring(
                id           = str(seg.get("id", "")),
                safety_score = int(seg.get("safety_score", 50)),
                confidence   = int(seg.get("confidence_score", 30)),
                length_km    = length_km,
            ))

    return matched
