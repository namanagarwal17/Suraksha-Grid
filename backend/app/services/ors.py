from __future__ import annotations

import os
from typing import Any

import httpx

from app.config import get_settings

import math

DEFAULT_ORS_URL = "https://api.openrouteservice.org/v2/directions"
ORS_MAX_ALTERNATIVES_DISTANCE_METERS = 100_000.0  # ORS alternative routes limit is 100 km


class ORSError(Exception):
    """Raised when OpenRouteService cannot calculate a route."""


def _haversine_meters(c1: list[float], c2: list[float]) -> float:
    """Great-circle distance between two [lng, lat] coordinates in meters."""
    lng1, lat1 = c1[0], c1[1]
    lng2, lat2 = c2[0], c2[1]
    r = 6371000.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2.0) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(max(0.0, a)), math.sqrt(max(0.0, 1.0 - a)))
    return r * c


async def get_ors_routes(
    origin: list[float],
    destination: list[float],
    profile: str = "foot-walking",
) -> list[dict[str, Any]]:
    """
    Calculate routes using OpenRouteService.

    Coordinates are [longitude, latitude].
    API key stays server-side.
    For distances > 100 km, requests standard directions without alternative_routes
    to comply with ORS alternative route distance constraints.
    If alternative_routes returns HTTP 400, automatically falls back to standard routing.
    """

    settings = get_settings()
    api_key = os.getenv("OPENROUTESERVICE_API_KEY") or settings.openrouteservice_api_key

    if not api_key:
        raise ORSError("OPENROUTESERVICE_API_KEY is not configured")

    if profile not in {
        "foot-walking",
        "driving-car",
        "cycling-regular",
    }:
        raise ORSError(f"Unsupported routing profile: {profile}")

    # Determine if alternatives are supported based on straight-line distance
    dist_m = _haversine_meters(origin, destination)
    include_alternatives = dist_m <= ORS_MAX_ALTERNATIVES_DISTANCE_METERS

    payload: dict[str, Any] = {
        "coordinates": [origin, destination],
        "format": "geojson",
        "instructions": False,
    }
    if include_alternatives:
        payload["alternative_routes"] = {
            "target_count": 3,
            "share_factor": 0.6,
            "weight_factor": 1.4,
        }

    base_url = (os.getenv("ORS_BASE_URL") or settings.ors_base_url or DEFAULT_ORS_URL).rstrip("/")
    if base_url.endswith("/geojson"):
        url = f"{base_url}/{profile}"
    else:
        url = f"{base_url}/{profile}/geojson"

    headers = {
        "Authorization": api_key,
        "Content-Type": "application/json",
        "Accept": "application/json, application/geo+json, application/gpx+xml",
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                url,
                headers=headers,
                json=payload,
            )

            # If request with alternatives failed (e.g. HTTP 400 distance limit exceeded),
            # retry standard directions without alternative_routes
            if response.status_code == 400 and include_alternatives:
                standard_payload = {
                    "coordinates": [origin, destination],
                    "format": "geojson",
                    "instructions": False,
                }
                fallback_response = await client.post(
                    url,
                    headers=headers,
                    json=standard_payload,
                )
                if fallback_response.status_code < 400:
                    response = fallback_response

    except httpx.RequestError as exc:
        raise ORSError(f"ORS network error: {exc}") from exc

    if response.status_code >= 400:
        try:
            detail_data = response.json()
            if isinstance(detail_data, dict) and "error" in detail_data:
                err_info = detail_data["error"]
                detail = err_info.get("message") if isinstance(err_info, dict) else str(err_info)
            else:
                detail = str(detail_data)
        except Exception:
            detail = "Routing provider request failed"

        raise ORSError(
            f"ORS returned HTTP {response.status_code}: {detail}"
        )

    data = response.json()

    # Standard GeoJSON response
    features = data.get("features", [])

    # Fallback if the provider returns a routes array
    if not features and isinstance(data.get("routes"), list):
        for r in data["routes"]:
            if isinstance(r, dict):
                geom = r.get("geometry")
                if isinstance(geom, dict):
                    features.append({
                        "type": "Feature",
                        "geometry": geom,
                        "properties": {
                            "summary": r.get("summary", {}),
                            "segments": r.get("segments", []),
                        },
                    })

    if not features:
        raise ORSError(
            f"ORS returned no routes (HTTP {response.status_code})."
        )

    # Validate and deduplicate identical route geometries
    unique_features: list[dict[str, Any]] = []
    seen_signatures = set()
    for feat in features:
        if not isinstance(feat, dict):
            continue
        geom = feat.get("geometry")
        if not isinstance(geom, dict):
            continue
        coords = geom.get("coordinates")
        if not coords or not isinstance(coords, list) or len(coords) < 2:
            continue

        c0 = tuple(coords[0][:2]) if isinstance(coords[0], (list, tuple)) and len(coords[0]) >= 2 else ()
        cm = tuple(coords[len(coords) // 2][:2]) if isinstance(coords[len(coords) // 2], (list, tuple)) and len(coords[len(coords) // 2]) >= 2 else ()
        c1 = tuple(coords[-1][:2]) if isinstance(coords[-1], (list, tuple)) and len(coords[-1]) >= 2 else ()
        sig = (len(coords), c0, cm, c1)

        if sig not in seen_signatures:
            seen_signatures.add(sig)
            unique_features.append(feat)

    if not unique_features:
        raise ORSError("ORS returned no valid route features with coordinates.")

    return unique_features