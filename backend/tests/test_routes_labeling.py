"""
Tests for route scoring, confidence enforcement, and deterministic route labeling.
Validates Fastest / Balanced / Safest / Alternative assignment rules.
"""
import pytest
from app.api.v1.routes import _label_routes, MIN_CONFIDENCE_FOR_SAFEST


class TestRouteLabeling:
    def test_single_route_labeled_direct_route_never_safest(self):
        routes = [{
            "duration_s": 600,
            "distance_m": 1000,
            "geometry": {"type": "LineString", "coordinates": []},
            "safety_score": 85,
            "confidence": 70,
            "segment_count": 5,
        }]
        labeled = _label_routes(routes)
        assert len(labeled) == 1
        assert labeled[0]["name"] == "Direct Route"
        assert labeled[0]["recommended"] is True

    def test_two_routes_insufficient_confidence_labeled_alternative(self):
        routes = [
            {
                "duration_s": 500,
                "distance_m": 800,
                "geometry": {"type": "LineString", "coordinates": []},
                "safety_score": 50,
                "confidence": 20,       # Low confidence (< 35)
                "segment_count": 0,      # No segment data
            },
            {
                "duration_s": 700,
                "distance_m": 1100,
                "geometry": {"type": "LineString", "coordinates": []},
                "safety_score": 90,      # High numerical score, but unevidenced!
                "confidence": 25,       # Low confidence (< 35)
                "segment_count": 0,
            },
        ]
        labeled = _label_routes(routes)
        assert len(labeled) == 2
        names = [r["name"] for r in labeled]
        assert "Fastest" in names
        # Must NOT be labeled "Safest" due to lack of evidence!
        assert "Safest" not in names
        assert "Alternative" in names
        # Check uncertainty explanation
        for r in labeled:
            assert "unverified baseline estimate" in r["explanation"]

    def test_two_routes_adequate_evidence_labeled_safest(self):
        routes = [
            {
                "duration_s": 500,
                "distance_m": 800,
                "geometry": {"type": "LineString", "coordinates": []},
                "safety_score": 60,
                "confidence": 60,
                "segment_count": 3,
            },
            {
                "duration_s": 650,
                "distance_m": 1000,
                "geometry": {"type": "LineString", "coordinates": []},
                "safety_score": 85,
                "confidence": 75,
                "segment_count": 4,
            },
        ]
        labeled = _label_routes(routes)
        assert len(labeled) == 2
        names = [r["name"] for r in labeled]
        assert "Fastest" in names
        assert "Safest" in names

    def test_three_routes_insufficient_evidence_safest_downgraded_to_alternative(self):
        routes = [
            {
                "duration_s": 400,
                "distance_m": 700,
                "geometry": {"type": "LineString", "coordinates": []},
                "safety_score": 50,
                "confidence": 20,
                "segment_count": 0,
            },
            {
                "duration_s": 500,
                "distance_m": 850,
                "geometry": {"type": "LineString", "coordinates": []},
                "safety_score": 55,
                "confidence": 20,
                "segment_count": 0,
            },
            {
                "duration_s": 600,
                "distance_m": 950,
                "geometry": {"type": "LineString", "coordinates": []},
                "safety_score": 80,
                "confidence": 20,
                "segment_count": 0,
            },
        ]
        labeled = _label_routes(routes)
        assert len(labeled) == 3
        names = [r["name"] for r in labeled]
        assert "Fastest" in names
        assert "Balanced" in names
        assert "Safest" not in names
        assert "Alternative" in names

    def test_empty_route_list_handled_without_error(self):
        assert _label_routes([]) == []

    def test_single_route_never_invents_alternatives(self):
        coords = [[77.0, 28.0], [77.01, 28.01], [77.02, 28.02]]
        routes = [{
            "duration_s": 1200,
            "distance_m": 5000,
            "geometry": {"type": "LineString", "coordinates": coords},
            "coords": coords,
            "safety_score": 75,
            "confidence": 60,
            "segment_count": 3,
            "explanation": "Calculated score.",
        }]
        labeled = _label_routes(routes)
        # Exactly 1 route returned
        assert len(labeled) == 1
        assert labeled[0]["name"] == "Direct Route"
        assert labeled[0]["geometry"]["coordinates"] == coords
        assert labeled[0]["safety_score"] == 75

    def test_each_alternative_preserves_independent_geometry(self):
        coords1 = [[77.0, 28.0], [77.01, 28.01]]
        coords2 = [[77.0, 28.0], [77.005, 28.015], [77.01, 28.01]]
        coords3 = [[77.0, 28.0], [77.002, 28.008], [77.01, 28.01]]
        routes = [
            {
                "duration_s": 400,
                "distance_m": 700,
                "geometry": {"type": "LineString", "coordinates": coords1},
                "safety_score": 50,
                "confidence": 50,
                "segment_count": 1,
            },
            {
                "duration_s": 500,
                "distance_m": 850,
                "geometry": {"type": "LineString", "coordinates": coords2},
                "safety_score": 70,
                "confidence": 50,
                "segment_count": 2,
            },
            {
                "duration_s": 600,
                "distance_m": 950,
                "geometry": {"type": "LineString", "coordinates": coords3},
                "safety_score": 85,
                "confidence": 60,
                "segment_count": 2,
            },
        ]
        labeled = _label_routes(routes)
        assert len(labeled) == 3
        # Each labeled route retains its unique, independent geometry
        geoms = [r["geometry"]["coordinates"] for r in labeled]
        assert coords1 in geoms
        assert coords2 in geoms
        assert coords3 in geoms
        assert len({tuple(map(tuple, g)) for g in geoms}) == 3

