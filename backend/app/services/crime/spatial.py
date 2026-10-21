"""
Spatial helpers for historical crime evidence.

Uses PostGIS via Supabase RPC to avoid pulling large geometry into Python.
All coordinate maths happens inside PostgreSQL.

If PostGIS or the historical_crime_evidence table is empty, every function
returns graceful empty results — the rest of the app is unaffected.
"""
from __future__ import annotations

import logging
from typing import Any

from app.services.crime.config import (
    MIN_INTERSECTION_METRES,
    EXPOSURE_HIGH_THRESHOLD,
    EXPOSURE_MOD_THRESHOLD,
)
from app.services.crime.models import CrimeIntersection, EvidenceLevel

logger = logging.getLogger(__name__)


def _evidence_level(total_exposure: float) -> EvidenceLevel:
    if total_exposure >= EXPOSURE_HIGH_THRESHOLD:
        return "HIGH"
    if total_exposure >= EXPOSURE_MOD_THRESHOLD:
        return "MODERATE"
    if total_exposure > 0:
        return "LOW"
    return "NONE"


async def route_crime_intersections(
    db,                      # supabase Client
    route_wkt: str,          # WKT LineString, SRID 4326
    route_length_m: float,
) -> list[CrimeIntersection]:
    """
    Query all historical_crime_evidence rows whose geometry intersects
    the given route LineString. Returns one CrimeIntersection per row.

    Relies on the PostGIS ST_Intersection / ST_Length RPC defined in
    migration 005. Falls back to empty list on any error.
    """
    if route_length_m <= 0:
        return []
    try:
        # Call the DB-side RPC that does the heavy lifting
        resp = db.rpc(
            "crime_route_intersections",
            {
                "p_route_wkt":      route_wkt,
                "p_route_length_m": route_length_m,
                "p_min_length_m":   MIN_INTERSECTION_METRES,
            },
        ).execute()

        rows: list[dict[str, Any]] = resp.data or []
        intersections = []
        for r in rows:
            intersections.append(CrimeIntersection(
                district         = r.get("district",""),
                state            = r.get("state",""),
                crime_category   = r.get("crime_category",""),
                incident_count   = int(r.get("incident_count",0)),
                year             = int(r.get("year",0)),
                severity_weight  = float(r.get("severity_weight",0.3)),
                intersection_m   = float(r.get("intersection_m",0)),
                route_length_m   = route_length_m,
                source           = r.get("source",""),
                source_dataset   = r.get("source_dataset",""),
            ))
        return intersections
    except Exception as exc:
        logger.warning("Spatial query failed (table may be empty): %s", exc)
        return []


async def check_dataset_available(db) -> bool:
    """Return True if at least one row exists in historical_crime_evidence."""
    try:
        resp = (
            db.table("historical_crime_evidence")
            .select("id", count="exact")
            .limit(1)
            .execute()
        )
        return (resp.count or 0) > 0
    except Exception:
        return False