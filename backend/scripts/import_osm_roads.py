"""
Suraksha Grid — Real OSM Road Segments Importer for Jaipur and Alwar.

Validates and imports verified road geometries from OSM GeoJSON files:
  - data/crime/raw/osm/jaipur_roads.geojson
  - data/crime/raw/osm/alwar_roads.geojson

Features:
  - Idempotent upsert via deterministic UUID5 based on city and OSM ID.
  - Geometry validation (LineString, valid bounds in Rajasthan: lon 75-77, lat 26-28).
  - Deduplication and road categorization.
  - Data-backed initial baseline indicators derived from genuine highway tags.
  - Does NOT delete or overwrite user reports or unrelated records.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, uuid5

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Valid bounding boxes for geographic sanity checks
CITY_BBOXES = {
    "jaipur": {"min_lon": 75.6, "max_lon": 76.0, "min_lat": 26.7, "max_lat": 27.1},
    "alwar":  {"min_lon": 76.4, "max_lon": 76.9, "min_lat": 27.3, "max_lat": 27.8},
}

HIGHWAY_WEIGHTS = {
    "trunk":        {"score": 75, "lighting": 70, "activity": 65, "emergency": "Good"},
    "primary":      {"score": 72, "lighting": 68, "activity": 70, "emergency": "Good"},
    "secondary":    {"score": 64, "lighting": 55, "activity": 55, "emergency": "Fair"},
    "tertiary":     {"score": 58, "lighting": 45, "activity": 45, "emergency": "Fair"},
    "residential":  {"score": 54, "lighting": 40, "activity": 40, "emergency": "Fair"},
    "service":      {"score": 48, "lighting": 35, "activity": 30, "emergency": "Limited"},
    "unclassified": {"score": 50, "lighting": 40, "activity": 35, "emergency": "Limited"},
    "living_street":{"score": 60, "lighting": 50, "activity": 50, "emergency": "Fair"},
}


def make_stable_uuid(city: str, osm_id: str) -> str:
    """Generate a repeatable, idempotent UUID from city and OSM ID."""
    clean_id = str(osm_id).replace("way/", "").strip()
    return str(uuid5(NAMESPACE_URL, f"https://suraksha.grid/roads/{city}/{clean_id}"))


def validate_coordinates(coords: list[Any], city: str) -> list[tuple[float, float]] | None:
    """Validate coordinate array, ensuring correct [lon, lat] order within city bounds."""
    if not isinstance(coords, list) or len(coords) < 2:
        return None

    bbox = CITY_BBOXES.get(city)
    valid_points: list[tuple[float, float]] = []

    for pt in coords:
        if not isinstance(pt, (list, tuple)) or len(pt) < 2:
            return None
        try:
            lon = float(pt[0])
            lat = float(pt[1])
        except (ValueError, TypeError):
            return None

        # Basic longitude/latitude range check
        if not (-180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
            return None

        # Regional sanity check for Rajasthan
        if bbox:
            if not (bbox["min_lon"] <= lon <= bbox["max_lon"] and bbox["min_lat"] <= lat <= bbox["max_lat"]):
                return None

        valid_points.append((lon, lat))

    if len(valid_points) < 2:
        return None

    return valid_points


def to_wkt(points: list[tuple[float, float]]) -> str:
    """Format coordinates as PostGIS EWKT."""
    coords_str = ", ".join(f"{lon:.6f} {lat:.6f}" for lon, lat in points)
    return f"SRID=4326;LINESTRING({coords_str})"


def clean_road_name(properties: dict[str, Any], city: str) -> str:
    """Extract or formulate an honest, descriptive road name from OSM properties."""
    name = properties.get("name")
    if name and isinstance(name, str) and name.strip():
        return name.strip()

    name_en = properties.get("name:en")
    if name_en and isinstance(name_en, str) and name_en.strip():
        return name_en.strip()

    ref = properties.get("ref")
    if ref and isinstance(ref, str) and ref.strip():
        return f"{ref.strip()} ({city.title()})"

    hw = str(properties.get("highway") or "road").replace("_", " ").title()
    return f"{hw}, {city.title()}"


def process_geojson(
    file_path: Path,
    city: str,
    major_only: bool = True,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Parse and validate road features from a GeoJSON file."""
    if not file_path.exists():
        raise FileNotFoundError(f"Dataset not found: {file_path}")

    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    features = data.get("features", [])
    valid_records: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    stats = {
        "total_features": len(features),
        "valid": 0,
        "skipped_geometry": 0,
        "skipped_duplicates": 0,
        "skipped_minor": 0,
    }

    for f in features:
        geom = f.get("geometry", {})
        if geom.get("type") != "LineString":
            stats["skipped_geometry"] += 1
            continue

        raw_coords = geom.get("coordinates")
        valid_coords = validate_coordinates(raw_coords, city)
        if not valid_coords:
            stats["skipped_geometry"] += 1
            continue

        props = f.get("properties", {})
        osm_id = props.get("@id") or f.get("id") or str(len(valid_records))
        stable_id = make_stable_uuid(city, osm_id)

        if stable_id in seen_ids:
            stats["skipped_duplicates"] += 1
            continue
        seen_ids.add(stable_id)

        highway = str(props.get("highway") or "").lower()
        has_name = bool(props.get("name") or props.get("ref"))

        # If major_only is requested, filter out unnamed residential / service paths
        if major_only:
            is_major = highway in ("trunk", "primary", "secondary", "tertiary")
            if not is_major and not has_name:
                stats["skipped_minor"] += 1
                continue

        road_name = clean_road_name(props, city)
        hw_config = HIGHWAY_WEIGHTS.get(highway, HIGHWAY_WEIGHTS["residential"])

        wkt = to_wkt(valid_coords)

        record = {
            "id": stable_id,
            "name": road_name,
            "geometry": wkt,
            "safety_score": hw_config["score"],
            "confidence_score": 35,  # Transparent baseline confidence (infrastructure attributes)
            "lighting_score": hw_config["lighting"],
            "pedestrian_activity_score": hw_config["activity"],
            "emergency_access_score": 75 if hw_config["emergency"] == "Good" else 55,
            "emergency_access_label": hw_config["emergency"],
            "time_condition": "Standard urban street profile",
            "explanation": f"Verified OpenStreetMap {highway or 'road'} segment in {city.title()}. Baseline score from physical road classification.",
            "recent_reports_count": 0,
        }

        valid_records.append(record)
        stats["valid"] += 1

    return valid_records, stats


async def import_roads_to_db(records: list[dict[str, Any]], batch_size: int = 100) -> int:
    """Insert or update road segments in Supabase in batches."""
    from app.db.client import get_supabase

    db = get_supabase()
    total_imported = 0

    for i in range(0, len(records), batch_size):
        batch = records[i : i + batch_size]
        try:
            resp = db.table("road_segments").upsert(batch, on_conflict="id").execute()
            count = len(resp.data or [])
            total_imported += count
            logger.info("Imported batch %d–%d (%d records)", i + 1, i + len(batch), count)
        except Exception as exc:
            logger.error("Failed to insert batch starting at index %d: %s", i, exc)
            raise

    return total_imported


def main():
    parser = argparse.ArgumentParser(description="Import verified OSM roads for Jaipur and Alwar")
    parser.add_argument("--city", choices=["jaipur", "alwar", "all"], default="all")
    parser.add_argument("--dry-run", action="store_true", help="Validate without writing to database")
    parser.add_argument("--all-roads", action="store_true", help="Import all roads including unnamed residential")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of roads to import per city")
    parser.add_argument("--batch-size", type=int, default=100)
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent.parent
    cities = ["jaipur", "alwar"] if args.city == "all" else [args.city]

    all_records = []

    for city in cities:
        path = project_root / "data" / "crime" / "raw" / "osm" / f"{city}_roads.geojson"
        logger.info("Processing %s from %s...", city.title(), path)
        records, stats = process_geojson(path, city, major_only=not args.all_roads)
        logger.info(
            "%s: total features %d, valid selected %d, skipped minor %d, skipped geom %d",
            city.title(),
            stats["total_features"],
            stats["valid"],
            stats["skipped_minor"],
            stats["skipped_geometry"],
        )

        if args.limit:
            records = records[: args.limit]

        all_records.extend(records)

    logger.info("Total records prepared for import: %d", len(all_records))

    if args.dry_run:
        logger.info("DRY-RUN completed successfully. No records written to database.")
        if all_records:
            print("Sample record:")
            print(json.dumps({k: v for k, v in all_records[0].items() if k != "geometry"}, indent=2))
        return

    imported = asyncio.run(import_roads_to_db(all_records, batch_size=args.batch_size))
    logger.info("Successfully imported %d road segments into Supabase road_segments table.", imported)


if __name__ == "__main__":
    main()
