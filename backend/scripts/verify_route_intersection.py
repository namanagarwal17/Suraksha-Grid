"""
Verification script — run against the real Supabase DB.

Picks a district with an existing geometry, constructs a route through
its centroid, and verifies crime_route_intersections returns evidence.
Also verifies a far-away route returns nothing.

Usage:
    cd backend && python -m scripts.verify_route_intersection
"""
from __future__ import annotations

import asyncio
import sys
import logging
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def main() -> int:
    from app.db.client import get_supabase
    db = get_supabase()

    # ── Check dataset availability ─────────────────────────────────────────
    resp = db.table("historical_crime_evidence").select("id", count="exact").limit(1).execute()
    total = resp.count or 0
    if total == 0:
        logger.error("historical_crime_evidence is empty — import data first")
        return 1
    logger.info("Total rows in historical_crime_evidence: %d", total)

    # Count rows with geometry
    resp2 = (
        db.table("historical_crime_evidence")
        .select("id", count="exact")
        .not_.is_("geometry", "null")
        .limit(1)
        .execute()
    )
    geom_count = resp2.count or 0
    logger.info("Rows with geometry: %d", geom_count)
    if geom_count == 0:
        logger.error("No geometry attached yet — run join_geometry.py first")
        return 1

    # ── Pick one geometry and build a test route through its centroid ──────
    # Use PostgREST to call ST_AsText(geometry) via RPC/raw SQL — not directly
    # supported; instead use a helper RPC if available, else skip live test.
    try:
        centroid_resp = db.rpc("pg_query", {}).execute()
    except Exception:
        pass  # RPC not available — use a manual SQL approach

    # Try fetching a row's WKT via a select with ::text cast
    try:
        row_resp = (
            db.table("historical_crime_evidence")
            .select("state, district, geometry::text")
            .not_.is_("geometry", "null")
            .limit(1)
            .execute()
        )
        row = (row_resp.data or [None])[0]
        if not row:
            logger.error("Could not fetch sample geometry")
            return 1

        state    = row["state"]
        district = row["district"]
        geom_wkt = row.get("geometry")  # WKT text
        logger.info("Sample district: %s / %s", state, district)
        logger.info("Geometry (truncated): %s…", str(geom_wkt)[:80])
    except Exception as exc:
        logger.error("Could not fetch sample geometry: %s", exc)
        return 1

    # ── Build a small route through the centroid (stub — centroid approx.) ──
    # For a real polygon centroid we'd need PostGIS; use a bounding-box
    # approach on the WKT text to extract one coordinate pair.
    import re
    coords = re.findall(r"([-\d.]+)\s+([-\d.]+)", geom_wkt or "")
    if not coords:
        logger.error("Could not parse coordinates from WKT: %s", geom_wkt)
        return 1

    xs = [float(c[0]) for c in coords]
    ys = [float(c[1]) for c in coords]
    cx = (min(xs) + max(xs)) / 2
    cy = (min(ys) + max(ys)) / 2
    delta = 0.05  # ~5 km

    route_wkt    = f"LINESTRING({cx - delta} {cy}, {cx + delta} {cy})"
    route_len_m  = 11_000.0

    logger.info("Test route through %s/%s centroid (%.4f,%.4f): %s",
                state, district, cx, cy, route_wkt)

    # ── Positive test ─────────────────────────────────────────────────────
    pos_resp = db.rpc(
        "crime_route_intersections",
        {"p_route_wkt": route_wkt, "p_route_length_m": route_len_m, "p_min_length_m": 50.0}
    ).execute()
    positives = pos_resp.data or []
    logger.info("Positive intersection result (%d rows):", len(positives))
    for r in positives[:3]:
        logger.info("  %s / %s / %s → %.0f m", r["state"], r["district"],
                    r["crime_category"], r.get("intersection_m", 0))
    if not positives:
        logger.error("FAIL: expected intersection but got 0 rows")
        return 1
    logger.info("PASS: positive intersection test")

    # ── Negative test (far-away route — middle of the Bay of Bengal) ───────
    neg_wkt = "LINESTRING(88.0 15.0, 89.0 15.0)"
    neg_resp = db.rpc(
        "crime_route_intersections",
        {"p_route_wkt": neg_wkt, "p_route_length_m": 110_000.0, "p_min_length_m": 50.0}
    ).execute()
    negatives = neg_resp.data or []
    if negatives:
        logger.error("FAIL: expected 0 intersections for far-away route, got %d", len(negatives))
        return 1
    logger.info("PASS: negative intersection test (far-away route → 0 rows)")

    logger.info("ALL VERIFICATION TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
