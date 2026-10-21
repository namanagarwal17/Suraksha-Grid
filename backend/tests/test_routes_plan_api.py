"""
API endpoint tests for /api/v1/routes/plan.
Tests short-distance alternatives, long-distance fallback, safety score separation,
and recoverable error handling.
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient

from app.main import app
from app.db.client import get_supabase
from app.services.ors import ORSError


@pytest.fixture
def mock_db():
    db = MagicMock()
    # Mock empty segments response or valid segments
    table_mock = MagicMock()
    table_mock.select.return_value.execute.return_value = MagicMock(data=[
        {
            "id": "seg-1",
            "safety_score": 75,
            "confidence_score": 60,
            "geometry": {
                "type": "LineString",
                "coordinates": [[77.0, 28.0], [77.01, 28.01]],
            },
        }
    ])
    db.table.return_value = table_mock
    return db


def test_plan_routes_short_distance_alternatives(mock_db):
    app.dependency_overrides[get_supabase] = lambda: mock_db
    client = TestClient(app, raise_server_exceptions=False)

    feat1 = {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [[77.0, 28.0], [77.01, 28.01]]},
        "properties": {"summary": {"duration": 600, "distance": 1000}},
    }
    feat2 = {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [[77.0, 28.0], [77.005, 28.005], [77.01, 28.01]]},
        "properties": {"summary": {"duration": 800, "distance": 1200}},
    }

    with patch("app.api.v1.routes.get_ors_routes", new_callable=AsyncMock) as mock_ors:
        mock_ors.return_value = [feat1, feat2]

        resp = client.post(
            "/api/v1/routes/plan",
            json={
                "origin": [77.0, 28.0],
                "destination": [77.01, 28.01],
                "profile": "foot-walking",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["source"] == "openrouteservice"
        assert len(data["routes"]) == 2
        # Check both routes have real geometry and safety engine output
        assert data["routes"][0]["geometry"]["coordinates"] == feat1["geometry"]["coordinates"]
        assert data["routes"][1]["geometry"]["coordinates"] == feat2["geometry"]["coordinates"]
        assert "safety_score" in data["routes"][0]["properties"]
        assert "confidence" in data["routes"][0]["properties"]

    app.dependency_overrides.clear()


def test_plan_routes_long_distance_single_route_no_synthetic_alternatives(mock_db):
    app.dependency_overrides[get_supabase] = lambda: mock_db
    client = TestClient(app, raise_server_exceptions=False)

    delhi = [77.2090, 28.6139]
    jaipur = [75.7873, 26.9124]
    long_feat = {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [delhi, [76.5, 27.5], jaipur]},
        "properties": {"summary": {"duration": 18000, "distance": 240000}},
    }

    with patch("app.api.v1.routes.get_ors_routes", new_callable=AsyncMock) as mock_ors:
        # Long route returns exactly 1 standard route
        mock_ors.return_value = [long_feat]

        resp = client.post(
            "/api/v1/routes/plan",
            json={
                "origin": delhi,
                "destination": jaipur,
                "profile": "driving-car",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["source"] == "openrouteservice"
        # Exactly 1 route returned — never synthetic Fastest/Balanced/Safest
        assert len(data["routes"]) == 1
        r0 = data["routes"][0]
        assert r0["properties"]["route_name"] == "Direct Route"
        assert r0["properties"]["recommended"] is True
        assert r0["geometry"]["coordinates"] == long_feat["geometry"]["coordinates"]
        # Safety analysis was performed
        assert "safety_score" in r0["properties"]
        assert "confidence" in r0["properties"]

    app.dependency_overrides.clear()


def test_plan_routes_recoverable_error_on_ors_failure(mock_db):
    app.dependency_overrides[get_supabase] = lambda: mock_db
    client = TestClient(app, raise_server_exceptions=False)

    with patch("app.api.v1.routes.get_ors_routes", new_callable=AsyncMock) as mock_ors:
        mock_ors.side_effect = ORSError("ORS returned HTTP 404: Route could not be found.")

        resp = client.post(
            "/api/v1/routes/plan",
            json={
                "origin": [77.0, 28.0],
                "destination": [77.01, 28.01],
                "profile": "foot-walking",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["source"] == "error"
        assert data["routes"] == []
        assert "Route could not be found" in data["error"]

    app.dependency_overrides.clear()


def test_plan_routes_historical_crime_intersection_integration(mock_db):
    app.dependency_overrides[get_supabase] = lambda: mock_db
    client = TestClient(app, raise_server_exceptions=False)

    feat = {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [[77.2090, 28.6139], [77.2400, 28.6300]]},
        "properties": {"summary": {"duration": 1200, "distance": 4000}},
    }

    from app.services.crime.models import CrimeIntersection

    mock_intersections = [
        CrimeIntersection(
            district="New Delhi",
            state="Delhi",
            crime_category="crime_against_women_ipc_sll",
            incident_count=93,
            year=2023,
            severity_weight=0.3,
            intersection_m=3200.0,
            route_length_m=4000.0,
            source="NCRB",
            source_dataset="Crime in India 2023",
        ),
        CrimeIntersection(
            district="Central",
            state="Delhi",
            crime_category="total_cognizable_ipc_crimes",
            incident_count=18567,
            year=2023,
            severity_weight=0.3,
            intersection_m=290.0,
            route_length_m=4000.0,
            source="NCRB",
            source_dataset="Crime in India 2023",
        ),
    ]

    with patch("app.api.v1.routes.get_ors_routes", new_callable=AsyncMock) as mock_ors, \
         patch("app.api.v1.routes.check_dataset_available", new_callable=AsyncMock) as mock_avail, \
         patch("app.api.v1.routes.route_crime_intersections", new_callable=AsyncMock) as mock_isect:

        mock_ors.return_value = [feat]
        mock_avail.return_value = True
        mock_isect.return_value = mock_intersections

        resp = client.post(
            "/api/v1/routes/plan",
            json={
                "origin": [77.2090, 28.6139],
                "destination": [77.2400, 28.6300],
                "profile": "foot-walking",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["routes"]) == 1
        r0 = data["routes"][0]["properties"]
        assert "historical_evidence" in r0
        hist = r0["historical_evidence"]
        assert hist["available"] is True
        assert hist["source"] == "NCRB"
        assert hist["intersections_count"] == 2
        assert len(hist["intersections"]) == 2
        assert hist["intersections"][0]["district"] == "New Delhi"
        assert hist["intersections"][1]["district"] == "Central"
        # Adjustment is non-positive
        assert hist["adjustment"] <= 0

    app.dependency_overrides.clear()


def test_plan_routes_crime_unavailable_honest_state(mock_db):
    app.dependency_overrides[get_supabase] = lambda: mock_db
    client = TestClient(app, raise_server_exceptions=False)

    feat = {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [[77.0, 28.0], [77.01, 28.01]]},
        "properties": {"summary": {"duration": 600, "distance": 1000}},
    }

    with patch("app.api.v1.routes.get_ors_routes", new_callable=AsyncMock) as mock_ors, \
         patch("app.api.v1.routes.check_dataset_available", new_callable=AsyncMock) as mock_avail:

        mock_ors.return_value = [feat]
        mock_avail.return_value = False

        resp = client.post(
            "/api/v1/routes/plan",
            json={
                "origin": [77.0, 28.0],
                "destination": [77.01, 28.01],
                "profile": "foot-walking",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        r0 = data["routes"][0]["properties"]
        assert "historical_evidence" in r0
        hist = r0["historical_evidence"]
        assert hist["available"] is False
        assert hist["level"] == "UNAVAILABLE"
        assert hist["adjustment"] == 0.0
        assert "not verified safe" in hist["explanation"]

    app.dependency_overrides.clear()
