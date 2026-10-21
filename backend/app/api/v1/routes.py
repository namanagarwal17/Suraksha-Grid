"""
Routes API.

GET  /api/v1/routes/           → pre-computed routes from Supabase
POST /api/v1/routes/plan       → real-time ORS routing + Safety Engine scoring

The /plan endpoint:
  1. Calls ORS for up to 3 alternative route geometries.
  2. Fetches pre-scored road_segments from Supabase (lighting, pedestrian
     activity, safety_score, confidence already computed by the Safety Engine).
  3. Spatially matches each route's bounding box to nearby segments.
  4. Passes matched segments to the existing score_route() (RouteScorer) to
     derive a length-weighted route-level safety score + confidence.
  5. Labels routes: Fastest = min duration, Safest = max safety_score (when
     confidence is adequate), Balanced = best composite of time + safety.
  6. Returns all safety evidence fields so the frontend can display real scores.
"""
from __future__ import annotations

import math
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.db.client import get_supabase
from app.schemas.models import RouteResponse
from app.services.data import get_all_routes
from app.services.ors import get_ors_routes, ORSError
from app.services.safety_engine import (
    SegmentForScoring,
    score_route,
)
from app.services.spatial import match_road_segments
from app.services.crime.spatial import route_crime_intersections, check_dataset_available
from app.services.crime.evidence import aggregate
from app.services.crime.config import SOURCE_DISCLAIMER

router = APIRouter()


MIN_CONFIDENCE_FOR_SAFEST = 35   # only trust safety ranking if confidence ≥ this and segment_count > 0


def _label_routes(
    parsed: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Assign Fastest / Balanced / Safest labels to ORS routes (1, 2, or 3 routes).

    Rules (deterministic, explainable, strictly avoids misleading "Safest"):
      - Fastest: route with minimum duration_s.
      - Safest: assigned ONLY IF a route has:
          1. Adequate evidence: confidence >= MIN_CONFIDENCE_FOR_SAFEST (35) AND segment_count > 0.
          2. Multiple routes to compare against (n >= 2).
          3. Demonstrable safety advantage over the fastest route.
        NEVER designated as "Safest" solely because of a numerical score when evidence is insufficient.
        When confidence is too low or segment data is missing, the alternative route is labeled
        "Alternative" rather than "Safest", with explicit uncertainty explanation.
      - Balanced: best composite of travel time and evidenced safety score.
    """
    n = len(parsed)
    if n == 0:
        return []

    # If any route has low confidence or 0 segments, explain uncertainty in its explanation
    for r in parsed:
        if r.get("confidence", 0) < MIN_CONFIDENCE_FOR_SAFEST or r.get("segment_count", 0) == 0:
            existing_exp = r.get("explanation") or ""
            if "unverified baseline estimate" not in existing_exp:
                r["explanation"] = (
                    f"{existing_exp} Note: Safety score is an unverified baseline estimate due to low confidence (<35%) or missing road segment data."
                    if existing_exp
                    else "Safety score is an unverified baseline estimate due to low confidence (<35%) or missing road segment data."
                )

    durations = [r["duration_s"] for r in parsed]
    safeties  = [r["safety_score"] for r in parsed]
    confs     = [r["confidence"] for r in parsed]
    seg_counts = [r.get("segment_count", 0) for r in parsed]

    # ---- Fastest ----
    fastest_idx = durations.index(min(durations))

    # ---- Safest Candidate Check ----
    # Must have confidence >= MIN_CONFIDENCE_FOR_SAFEST and at least 1 matched segment
    adequate = [
        i for i in range(n)
        if confs[i] >= MIN_CONFIDENCE_FOR_SAFEST and seg_counts[i] > 0
    ]

    has_safest = False
    safest_idx: Optional[int] = None

    if n >= 2 and adequate:
        best_safe_cand = max(adequate, key=lambda i: (safeties[i], confs[i], -durations[i]))
        if best_safe_cand != fastest_idx or len(adequate) > 1:
            safest_idx = best_safe_cand
            has_safest = True

    # ---- Composite for Balanced ----
    dur_min = min(durations); dur_max = max(durations)
    dur_range = max(1.0, dur_max - dur_min)
    norm_dur = [(d - dur_min) / dur_range for d in durations]

    safe_min = min(safeties); safe_max = max(safeties)
    safe_range = max(1.0, safe_max - safe_min)
    norm_safe = [(s - safe_min) / safe_range for s in safeties]

    def composite(i: int) -> float:
        safe_weight = 0.5 if (confs[i] >= MIN_CONFIDENCE_FOR_SAFEST and seg_counts[i] > 0) else 0.0
        dur_weight  = 1.0 - safe_weight
        return norm_dur[i] * dur_weight + (1.0 - norm_safe[i]) * safe_weight

    balanced_idx = min(range(n), key=composite)

    label_order: list[tuple[str, str, bool, int]] = []   # (route_id, name, recommended, idx)

    if n == 1:
        # A single returned route must NOT imply it has been proven safest
        label_order.append(("fastest", "Direct Route", True, 0))
    elif n == 2:
        other_idx = 1 if fastest_idx == 0 else 0
        if has_safest and safest_idx == other_idx:
            safest_rec = (balanced_idx == safest_idx)
            label_order.append(("fastest", "Fastest", not safest_rec, fastest_idx))
            label_order.append(("safest", "Safest", safest_rec, other_idx))
        else:
            label_order.append(("fastest", "Fastest", True, fastest_idx))
            label_order.append(("balanced", "Alternative", False, other_idx))
    else:  # n >= 3
        label_order.append(("fastest", "Fastest", False, fastest_idx))
        remaining = [i for i in range(n) if i != fastest_idx]

        if has_safest and safest_idx in remaining:
            label_order.append(("safest", "Safest", False, safest_idx))
            remaining.remove(safest_idx)
            b_idx = remaining[0]
            label_order.append(("balanced", "Balanced", True, b_idx))
        else:
            b_idx = min(remaining, key=composite)
            label_order.append(("balanced", "Balanced", True, b_idx))
            remaining.remove(b_idx)
            alt_idx = remaining[0]
            label_order.append(("safest", "Alternative", False, alt_idx))

    # Guarantee at least one route has recommended = True
    if label_order and not any(item[2] for item in label_order):
        first = label_order[0]
        label_order[0] = (first[0], first[1], True, first[3])

    label_order.sort(key=lambda x: x[3])

    result = []
    for route_id, name, recommended, idx in label_order:
        r = dict(parsed[idx])
        r["id"]          = route_id
        r["name"]        = name
        r["recommended"] = recommended
        result.append(r)

    return result


# ------------------------------------------------------------------ schemas

class RoutePlanRequest(BaseModel):
    origin:      list[float] = Field(min_length=2, max_length=2)
    destination: list[float] = Field(min_length=2, max_length=2)
    profile:     str = "foot-walking"


# ------------------------------------------------------------------ endpoints

@router.get("/", response_model=list[RouteResponse])
async def list_routes(db=Depends(get_supabase)):
    """Return all pre-computed route options ordered by safety score."""
    return await get_all_routes(db)


@router.post("/plan")
async def plan_routes(payload: RoutePlanRequest, db=Depends(get_supabase)):
    """
    Calculate real routes through ORS and score them with the Safety Engine.

    Steps:
      1. Fetch ORS alternative routes (up to 3 GeoJSON features).
      2. Fetch pre-scored road_segments from Supabase (read-only — scores were
         written by the existing Safety Engine pipeline).
      3. Spatially match each route to nearby segments via bbox proximity.
      4. Call score_route() (RouteScorer from safety_engine.py) on matched
         segments to produce a length-weighted route safety score + confidence.
      5. Label routes as Fastest / Balanced / Safest using deterministic rules.
      6. Return geometry + ORS metadata + Safety Engine output per route.
    """

    # Step 1: ORS routes
    try:
        features = await get_ors_routes(
            origin=payload.origin,
            destination=payload.destination,
            profile=payload.profile,
        )
    except ORSError as exc:
        return {"source": "error", "routes": [], "error": str(exc)}

    # Step 2: Fetch pre-scored segments (read-only — Safety Engine already ran)
    all_segments: list[dict[str, Any]] = []
    try:
        resp = (
            db.table("road_segments")
            .select("id,safety_score,confidence_score,geometry::json")
            .execute()
        )
        all_segments = resp.data or []
    except Exception:
        # DB unavailable — proceed without safety scoring
        all_segments = []

    # Check whether historical crime dataset is imported
    has_crime_dataset = await check_dataset_available(db)

    # Step 3–4: For each ORS feature, match segments + score with RouteScorer & crime spatial intersections
    parsed: list[dict[str, Any]] = []
    for feature in features:
        summary = (feature.get("properties") or {}).get("summary") or {}
        segs_prop = (feature.get("properties") or {}).get("segments") or []
        if not summary and segs_prop:
            summary = {
                "distance": segs_prop[0].get("distance", 0),
                "duration": segs_prop[0].get("duration", 0),
            }
        duration_s = float(summary.get("duration", 0))
        distance_m = float(summary.get("distance", 0))

        coords: list[list[float]] = (feature.get("geometry") or {}).get("coordinates", [])

        # Safety Engine: score this route's geometrically matched segments
        matched_segs = match_road_segments(coords, all_segments)
        route_safety = score_route(matched_segs)

        # Historical Crime Evidence: PostGIS route-intersection query
        risk_factors = list(route_safety.risk_factors)
        if has_crime_dataset and len(coords) >= 2 and distance_m > 0:
            try:
                # Construct WKT LineString: SRID 4326 (longitude latitude)
                route_wkt = f"LINESTRING({', '.join(f'{c[0]} {c[1]}' for c in coords)})"
                intersections = await route_crime_intersections(db, route_wkt, distance_m)
                crime_ev = aggregate(intersections, dataset_available=True)
                adj = crime_ev.score_adjustment
                # Historical evidence is an additive, negative score adjustment (bounded 0 to -12)
                final_safety_score = max(0, min(100, route_safety.safety_score + round(adj)))

                if adj <= -3.0:
                    rf_text = "Elevated historical crime density in intersected district(s)"
                    if rf_text not in risk_factors:
                        risk_factors.append(rf_text)

                hist_ev_payload = {
                    "available":           True,
                    "level":               crime_ev.evidence_level,
                    "adjustment":          round(crime_ev.score_adjustment, 2),
                    "confidence":          crime_ev.confidence,
                    "explanation":         crime_ev.explanation,
                    "source":              crime_ev.source or "NCRB",
                    "source_dataset":      crime_ev.source_dataset or "Crime in India 2023",
                    "years":               crime_ev.years,
                    "categories":          crime_ev.categories,
                    "intersections_count": len(intersections),
                    "intersections":       [
                        {
                            "district":          ix.district,
                            "state":             ix.state,
                            "crime_category":    ix.crime_category,
                            "incident_count":    ix.incident_count,
                            "year":              ix.year,
                            "severity_weight":   ix.severity_weight,
                            "intersection_m":    round(ix.intersection_m, 1),
                            "exposure_fraction": round(ix.exposure_fraction, 3),
                        }
                        for ix in intersections
                    ],
                    "disclaimer":          SOURCE_DISCLAIMER,
                }
            except Exception:
                final_safety_score = route_safety.safety_score
                hist_ev_payload = {
                    "available":           False,
                    "level":               "UNAVAILABLE",
                    "adjustment":          0.0,
                    "confidence":          0,
                    "explanation":         "Error calculating historical crime intersections.",
                    "source":              "",
                    "source_dataset":      "",
                    "years":               [],
                    "categories":          [],
                    "intersections_count": 0,
                    "intersections":       [],
                    "disclaimer":          SOURCE_DISCLAIMER,
                }
        else:
            final_safety_score = route_safety.safety_score
            hist_ev_payload = {
                "available":           False,
                "level":               "UNAVAILABLE",
                "adjustment":          0.0,
                "confidence":          0,
                "explanation":         "No historical crime data available for this area. Area is not verified safe.",
                "source":              "",
                "source_dataset":      "",
                "years":               [],
                "categories":          [],
                "intersections_count": 0,
                "intersections":       [],
                "disclaimer":          SOURCE_DISCLAIMER,
            }

        parsed.append({
            "duration_s":          duration_s,
            "distance_m":          distance_m,
            "coords":              coords,
            "geometry":            feature.get("geometry"),
            "properties":          feature.get("properties"),
            "safety_score":        final_safety_score,
            "confidence":          route_safety.confidence_score,
            "risk_factors":        risk_factors,
            "positive_factors":    route_safety.positive_factors,
            "explanation":         route_safety.explanation,
            "segment_count":       len(matched_segs),
            "segment_ids":         [s.id for s in matched_segs],
            "historical_evidence": hist_ev_payload,
        })

    # Step 5: Label routes
    labelled = _label_routes(parsed)

    # Step 6: Build response features (preserve original ORS geometry/properties)
    response_routes = []
    for r in labelled:
        response_routes.append({
            "type":       "Feature",
            "geometry":   r["geometry"],
            "properties": {
                **(r.get("properties") or {}),
                # Overlay our computed fields so the frontend can read them
                "route_id":            r["id"],
                "route_name":          r["name"],
                "recommended":         r["recommended"],
                "safety_score":        r["safety_score"],
                "confidence":          r["confidence"],
                "risk_factors":        r["risk_factors"],
                "positive_factors":    r["positive_factors"],
                "explanation":         r["explanation"],
                "segment_count":       r["segment_count"],
                "segment_ids":         r.get("segment_ids", []),
                "historical_evidence": r.get("historical_evidence"),
            },
        })

    return {
        "source":  "openrouteservice",
        "profile": payload.profile,
        "routes":  response_routes,
    }