"""
Tests for Spatial Matching Service (app.services.spatial).
Validates line-to-polyline corridor matching, coordinate handling,
tolerance buffers, and malformed geometry resilience.
"""
import pytest
from app.services.spatial import (
    point_to_polyline_dist_meters,
    is_segment_on_route,
    match_road_segments,
    compute_linestring_length_km,
)


class TestSpatialMatching:
    def test_segment_directly_on_route_matches(self):
        # Route along a straight line in Gurugram
        route = [
            [77.0250, 28.4550],
            [77.0300, 28.4550],
            [77.0350, 28.4550],
        ]
        # Road segment running along the middle of that route
        seg_coords = [
            [77.0260, 28.4550],
            [77.0290, 28.4550],
        ]
        assert is_segment_on_route(seg_coords, route, tolerance_meters=30.0) is True

    def test_nearby_unrelated_segment_outside_tolerance_does_not_match(self):
        # Route along lat 28.4550
        route = [
            [77.0250, 28.4550],
            [77.0350, 28.4550],
        ]
        # Parallel road segment 150m south (~0.00135 deg lat)
        seg_coords = [
            [77.0260, 28.4535],
            [77.0290, 28.4535],
        ]
        assert is_segment_on_route(seg_coords, route, tolerance_meters=30.0) is False

    def test_route_crossing_multiple_sequential_segments(self):
        # Long route crossing three road segments
        route = [
            [77.0200, 28.4500],
            [77.0300, 28.4500],
            [77.0400, 28.4500],
        ]
        all_segments = [
            {
                "id": "seg-1",
                "safety_score": 65,
                "confidence_score": 50,
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[77.0210, 28.4500], [77.0240, 28.4500]],
                },
            },
            {
                "id": "seg-2",
                "safety_score": 75,
                "confidence_score": 60,
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[77.0280, 28.4500], [77.0320, 28.4500]],
                },
            },
            {
                "id": "seg-unrelated",
                "safety_score": 90,
                "confidence_score": 80,
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[77.0250, 28.4600], [77.0280, 28.4600]],  # ~1.1km north
                },
            },
        ]
        matched = match_road_segments(route, all_segments, tolerance_meters=30.0)
        matched_ids = [m.id for m in matched]
        assert "seg-1" in matched_ids
        assert "seg-2" in matched_ids
        assert "seg-unrelated" not in matched_ids
        assert len(matched) == 2

    def test_missing_or_empty_route_geometry_returns_empty_list(self):
        all_segments = [
            {
                "id": "seg-1",
                "safety_score": 65,
                "confidence_score": 50,
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[77.0210, 28.4500], [77.0240, 28.4500]],
                },
            }
        ]
        assert match_road_segments([], all_segments) == []
        assert match_road_segments([[77.0, 28.0]], all_segments) == []  # only 1 point

    def test_malformed_coordinates_handled_gracefully(self):
        malformed_route = [
            [77.0200, 28.4500],
            "invalid_point",  # malformed entry
            [77.0400, 28.4500],
        ]
        all_segments = [
            {
                "id": "seg-1",
                "safety_score": 65,
                "confidence_score": 50,
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[77.0250, 28.4500], [77.0300, 28.4500]],
                },
            }
        ]
        # Should not raise exception
        matched = match_road_segments(malformed_route, all_segments)
        assert len(matched) == 1

    def test_linestring_length_calculation(self):
        coords = [
            [77.0000, 28.0000],
            [77.0100, 28.0000],
        ]
        length = compute_linestring_length_km(coords)
        assert 0.8 < length < 1.2

    def test_empty_and_disjoint_segments_handled_defensively(self):
        route = [
            [77.0200, 28.4500],
            [77.0300, 28.4500],
        ]
        # Disjoint distant segments should yield 0 matches without error
        distant_segments = [
            {
                "id": "distant-1",
                "safety_score": 70,
                "confidence_score": 60,
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[77.5000, 28.9000], [77.5100, 28.9000]],
                },
            }
        ]
        matched = match_road_segments(route, distant_segments)
        assert matched == []
