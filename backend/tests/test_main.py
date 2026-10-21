"""
Basic smoke tests for the FastAPI application.
Run with:  cd backend && pytest tests/ -v
These tests use the in-process TestClient — no real database required.
"""
from __future__ import annotations
import os
import pytest
from unittest.mock import patch, MagicMock

# Patch settings before importing app to avoid needing real env vars
DUMMY_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSJ9.signature"
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", DUMMY_JWT)
os.environ.setdefault("SUPABASE_ANON_KEY", DUMMY_JWT)
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")

from fastapi.testclient import TestClient
from app.main import app
from app.db.client import get_supabase

client = TestClient(app, raise_server_exceptions=False)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["service"] == "suraksha-grid-api"


def test_docs_available():
    resp = client.get("/docs")
    assert resp.status_code == 200


def test_segments_requires_db():
    """Without a real DB the endpoint should return a 500 (not a crash)."""
    def mock_db():
        raise RuntimeError("no db")

    app.dependency_overrides[get_supabase] = mock_db
    try:
        resp = client.get("/api/v1/segments/")
        assert resp.status_code in (500, 503)
    finally:
        app.dependency_overrides.clear()


def test_routes_requires_db():
    def mock_db():
        raise RuntimeError("no db")

    app.dependency_overrides[get_supabase] = mock_db
    try:
        resp = client.get("/api/v1/routes/")
        assert resp.status_code in (500, 503)
    finally:
        app.dependency_overrides.clear()