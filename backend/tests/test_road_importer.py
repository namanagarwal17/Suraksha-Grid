"""
Tests for OSM Road Importer and Geometry Processing (backend/scripts/import_osm_roads.py).
Validates GeoJSON parsing, coordinate order, bounding boxes for Jaipur & Alwar,
deterministic UUID5 idempotency, and geometry validation.
"""
import json
import uuid
from pathlib import Path
import pytest
from scripts.import_osm_roads import (
    make_stable_uuid,
    validate_coordinates,
    to_wkt,
    clean_road_name,
)


class TestRoadImporterLogic:
    def test_deterministic_uuid_is_repeatable_and_idempotent(self):
        id1 = make_stable_uuid("jaipur", "way/12345")
        id2 = make_stable_uuid("jaipur", "way/12345")
        id3 = make_stable_uuid("alwar", "way/12345")

        assert id1 == id2
        assert id1 != id3
        assert uuid.UUID(id1).version == 5

    def test_clean_road_name_extracts_proper_names(self):
        props_with_name = {"name": "Amer Road", "highway": "primary"}
        assert clean_road_name(props_with_name, "jaipur") == "Amer Road"

        props_with_name_en = {"name:en": "Tonk Road", "highway": "trunk"}
        assert clean_road_name(props_with_name_en, "jaipur") == "Tonk Road"

        props_unnamed = {"highway": "residential"}
        assert clean_road_name(props_unnamed, "jaipur") == "Residential, Jaipur"

        props_empty = {}
        assert clean_road_name(props_empty, "jaipur") == "Road, Jaipur"

    def test_validate_coordinates_and_to_wkt(self):
        # Coordinates in Jaipur bbox (lon ~75.8, lat ~26.9)
        valid_coords = [
            [75.7891, 26.9124],
            [75.7905, 26.9135],
            [75.7920, 26.9150],
        ]
        points = validate_coordinates(valid_coords, "jaipur")
        assert points is not None
        assert len(points) == 3

        ewkt = to_wkt(points)
        assert ewkt.startswith("SRID=4326;LINESTRING(")
        assert "75.789100 26.912400" in ewkt
        assert ewkt.endswith(")")

    def test_validate_coordinates_rejects_out_of_bounds_points(self):
        # Point outside Jaipur (e.g. London coordinates)
        invalid_coords = [
            [-0.1278, 51.5074],
            [-0.1280, 51.5080],
        ]
        assert validate_coordinates(invalid_coords, "jaipur") is None

    def test_jaipur_roads_geojson_integrity(self):
        repo_root = Path(__file__).resolve().parent.parent.parent
        geojson_path = repo_root / "data" / "crime" / "raw" / "osm" / "jaipur_roads.geojson"
        assert geojson_path.exists(), f"File {geojson_path} not found"

        with open(geojson_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        assert data.get("type") == "FeatureCollection"
        features = data.get("features", [])
        assert len(features) > 1000

        # Check sample coordinates are [lng, lat] within Jaipur bounding box (lng ~75.6 - 76.0, lat ~26.7 - 27.1)
        valid_sample_count = 0
        for feat in features[:100]:
            geom = feat.get("geometry", {})
            if geom.get("type") == "LineString":
                coords = geom.get("coordinates", [])
                if len(coords) >= 2:
                    lng, lat = coords[0][0], coords[0][1]
                    assert 75.0 <= lng <= 77.0, f"Unexpected longitude {lng} in Jaipur dataset"
                    assert 26.0 <= lat <= 28.0, f"Unexpected latitude {lat} in Jaipur dataset"
                    valid_sample_count += 1

        assert valid_sample_count > 50

    def test_alwar_roads_geojson_integrity(self):
        repo_root = Path(__file__).resolve().parent.parent.parent
        geojson_path = repo_root / "data" / "crime" / "raw" / "osm" / "alwar_roads.geojson"
        assert geojson_path.exists(), f"File {geojson_path} not found"

        with open(geojson_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        assert data.get("type") == "FeatureCollection"
        features = data.get("features", [])
        assert len(features) > 200

        # Check sample coordinates are [lng, lat] within Alwar bounding box (lng ~76.4 - 76.8, lat ~27.4 - 27.8)
        valid_sample_count = 0
        for feat in features[:50]:
            geom = feat.get("geometry", {})
            if geom.get("type") == "LineString":
                coords = geom.get("coordinates", [])
                if len(coords) >= 2:
                    lng, lat = coords[0][0], coords[0][1]
                    assert 76.0 <= lng <= 77.5, f"Unexpected longitude {lng} in Alwar dataset"
                    assert 27.0 <= lat <= 28.2, f"Unexpected latitude {lat} in Alwar dataset"
                    valid_sample_count += 1

        assert valid_sample_count > 20
