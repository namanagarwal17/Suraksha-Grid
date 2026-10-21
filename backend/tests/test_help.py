"""
Tests for Nearby Help API and OSM Overpass integration.
Verifies that nearby emergency places require genuine GPS coordinates,
sort nearest-first, and never return mock/demo data.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.help import clear_help_cache, haversine_km

client = TestClient(app)


def test_help_without_coordinates_returns_400():
    """Endpoint must refuse requests without user coordinates and never fall back to mock data."""
    resp = client.get("/api/v1/help")
    assert resp.status_code == 400
    assert "Latitude and longitude are required" in resp.json()["detail"]


def test_help_with_only_lat_returns_400():
    resp = client.get("/api/v1/help?lat=28.45")
    assert resp.status_code == 400


def test_help_haversine_calculation():
    """Verify distance calculation between known points."""
    # New Delhi (28.6139, 77.2090) to Connaught Place (28.6315, 77.2167) ~2 km
    d = haversine_km(28.6139, 77.2090, 28.6315, 77.2167)
    assert 1.5 < d < 2.5


def test_help_mocked_overpass_returns_genuine_places(monkeypatch):
    """Test parsing, distance calculation, deduplication and nearest-first sorting."""
    clear_help_cache()

    sample_elements = [
        {
            "type": "node",
            "id": 101,
            "lat": 28.4600,
            "lon": 77.0300,
            "tags": {
                "name": "District Civil Hospital",
                "amenity": "hospital",
                "emergency": "yes",
                "opening_hours": "24/7",
                "phone": "+91 124 1234567",
            },
        },
        {
            "type": "way",
            "id": 202,
            "center": {"lat": 28.4550, "lon": 77.0250},
            "tags": {
                "name": "City Police Station",
                "amenity": "police",
                "addr:street": "MG Road",
            },
        },
        {
            "type": "node",
            "id": 303,
            "lat": 28.4580,
            "lon": 77.0280,
            "tags": {
                "amenity": "fire_station",
            },
        },
    ]

    import app.services.help as help_service
    monkeypatch.setattr(help_service, "_query_nominatim", lambda lat, lng, rad: [])
    monkeypatch.setattr(help_service, "_query_overpass", lambda q: sample_elements)

    resp = client.get("/api/v1/help?lat=28.4595&lng=77.0266")
    assert resp.status_code == 200
    places = resp.json()
    assert len(places) == 3

    # Ensure nearest-first sorting
    distances = [p["distance_km"] for p in places]
    assert distances == sorted(distances)

    # Check classifications and tags
    p_map = {p["name"]: p for p in places}
    assert "District Civil Hospital" in p_map
    assert p_map["District Civil Hospital"]["type"] == "hospital"
    assert p_map["District Civil Hospital"]["open_24h"] is True
    assert p_map["District Civil Hospital"]["opening_hours"] == "Open 24h"

    assert "City Police Station" in p_map
    assert p_map["City Police Station"]["type"] == "police"

    # Default label when name is omitted
    fire_station = [p for p in places if p["type"] == "help"][0]
    assert fire_station["name"] == "Fire & Rescue Station"

    # Verify no mock places are present
    names = [p["name"] for p in places]
    assert "Sector 14 Police Station" not in names
    assert "Canal Road Help Point" not in names


def test_help_nominatim_parsing(monkeypatch):
    """Test Nominatim results parsing and sorting."""
    clear_help_cache()
    import app.services.help as help_service
    sample_nom = [
        {
            "id": "11111111-1111-1111-1111-111111111111",
            "name": "Local Police Post",
            "type": "police",
            "latitude": 28.4600,
            "longitude": 77.0270,
            "address": "Main Road, Gurugram",
            "phone": None,
            "open_24h": True,
            "opening_hours": "Open 24h",
            "distance_km": 0.12,
        }
    ]
    monkeypatch.setattr(help_service, "_query_nominatim", lambda lat, lng, rad: sample_nom)

    resp = client.get("/api/v1/help?lat=28.4595&lng=77.0266")
    assert resp.status_code == 200
    places = resp.json()
    assert len(places) == 1
    assert places[0]["name"] == "Local Police Post"


def test_help_empty_results_when_overpass_returns_nothing(monkeypatch):
    """When no genuine places exist within radius, return empty list honestly."""
    clear_help_cache()
    import app.services.help as help_service
    monkeypatch.setattr(help_service, "_query_nominatim", lambda lat, lng, rad: [])
    monkeypatch.setattr(help_service, "_query_overpass", lambda q: [])

    resp = client.get("/api/v1/help?lat=12.34&lng=56.78")
    assert resp.status_code == 200
    assert resp.json() == []
