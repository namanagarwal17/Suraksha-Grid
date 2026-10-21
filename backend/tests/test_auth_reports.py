"""
Tests for authentication and report ownership enforcement.
Verifies that client-provided user IDs cannot be spoofed without valid tokens,
and verifies cross-user ownership restrictions on image analysis.
"""
import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from fastapi.testclient import TestClient
from app.main import app
from app.db.client import get_supabase


@pytest.fixture
def mock_supabase():
    db = MagicMock()
    # Mock auth.get_user
    def get_user_mock(jwt):
        if jwt == "valid-token-user-1":
            user = MagicMock()
            user.id = "user-1"
            res = MagicMock()
            res.user = user
            return res
        elif jwt == "valid-token-user-2":
            user = MagicMock()
            user.id = "user-2"
            res = MagicMock()
            res.user = user
            return res
        raise Exception("Invalid JWT")

    db.auth.get_user = MagicMock(side_effect=get_user_mock)

    # Mock table operations for safety_reports
    table_mock = MagicMock()
    db.table.return_value = table_mock

    # Mock insert
    insert_mock = MagicMock()
    table_mock.insert.return_value = insert_mock
    insert_mock.execute.return_value = MagicMock(data=[{
        "id": "11111111-1111-4111-8111-111111111111",
        "category": "poor_lighting",
        "description": "dark corner",
        "latitude": 28.45,
        "longitude": 77.02,
        "status": "pending",
        "created_at": "2026-10-10T00:00:00Z",
    }])

    # Mock select
    select_mock = MagicMock()
    table_mock.select.return_value = select_mock
    eq_mock = MagicMock()
    select_mock.eq.return_value = eq_mock

    def maybe_single_mock():
        res = MagicMock()
        # Default report owned by user-1
        res.data = {"id": "11111111-1111-4111-8111-111111111111", "user_id": "user-1"}
        return MagicMock(execute=MagicMock(return_value=res))

    eq_mock.maybe_single = maybe_single_mock

    return db


class TestAuthAndReportOwnership:
    def test_guest_report_submission_without_credentials_succeeds(self, mock_supabase):
        app.dependency_overrides[get_supabase] = lambda: mock_supabase
        client = TestClient(app)

        payload = {
            "category": "poor_lighting",
            "description": "dark street",
            "latitude": 28.45,
            "longitude": 77.02,
            "severity": 2,
        }
        resp = client.post("/api/v1/reports/", json=payload)
        assert resp.status_code == 201
        app.dependency_overrides.clear()

    def test_spoofed_user_id_without_bearer_token_rejected_with_401(self, mock_supabase):
        app.dependency_overrides[get_supabase] = lambda: mock_supabase
        client = TestClient(app)

        payload = {
            "category": "poor_lighting",
            "latitude": 28.45,
            "longitude": 77.02,
        }
        # Client tries to spoof user identity via header without token
        resp = client.post(
            "/api/v1/reports/",
            json=payload,
            headers={"x-user-id": "victim-user-id"},
        )
        assert resp.status_code == 401
        assert "cannot be trusted without token" in resp.json()["detail"]
        app.dependency_overrides.clear()

    def test_authenticated_report_submission_with_valid_token(self, mock_supabase):
        app.dependency_overrides[get_supabase] = lambda: mock_supabase
        client = TestClient(app)

        payload = {
            "category": "poor_lighting",
            "latitude": 28.45,
            "longitude": 77.02,
        }
        resp = client.post(
            "/api/v1/reports/",
            json=payload,
            headers={"Authorization": "Bearer valid-token-user-1"},
        )
        assert resp.status_code == 201
        app.dependency_overrides.clear()

    def test_authenticated_report_submission_with_matching_token_and_x_user_id(self, mock_supabase):
        app.dependency_overrides[get_supabase] = lambda: mock_supabase
        client = TestClient(app)

        payload = {
            "category": "poor_lighting",
            "latitude": 28.45,
            "longitude": 77.02,
        }
        # Both Authorization Bearer token AND x-user-id forwarded by Next.js proxy
        resp = client.post(
            "/api/v1/reports/",
            json=payload,
            headers={
                "Authorization": "Bearer valid-token-user-1",
                "x-user-id": "user-1",
            },
        )
        assert resp.status_code == 201
        app.dependency_overrides.clear()

    def test_authenticated_report_submission_with_mismatched_x_user_id_rejected_with_403(self, mock_supabase):
        app.dependency_overrides[get_supabase] = lambda: mock_supabase
        client = TestClient(app)

        payload = {
            "category": "poor_lighting",
            "latitude": 28.45,
            "longitude": 77.02,
        }
        # Token says user-1, but x-user-id claims user-2
        resp = client.post(
            "/api/v1/reports/",
            json=payload,
            headers={
                "Authorization": "Bearer valid-token-user-1",
                "x-user-id": "user-2",
            },
        )
        assert resp.status_code == 403
        assert "Spoofed user ID" in resp.json()["detail"]
        app.dependency_overrides.clear()

    def test_analyse_image_unauthenticated_rejected_with_401(self, mock_supabase):
        app.dependency_overrides[get_supabase] = lambda: mock_supabase
        client = TestClient(app)

        resp = client.post(
            "/api/v1/reports/11111111-1111-4111-8111-111111111111/analyse-image",
            json={"image_url": "https://example.com/test.jpg"},
        )
        assert resp.status_code == 401
        app.dependency_overrides.clear()

    def test_analyse_image_cross_user_violation_rejected_with_403(self, mock_supabase):
        app.dependency_overrides[get_supabase] = lambda: mock_supabase
        client = TestClient(app)

        # rep-101 is owned by user-1; user-2 tries to access/analyse it
        resp = client.post(
            "/api/v1/reports/11111111-1111-4111-8111-111111111111/analyse-image",
            json={"image_url": "https://example.com/test.jpg"},
            headers={"Authorization": "Bearer valid-token-user-2"},
        )
        assert resp.status_code == 403
        assert "Forbidden" in resp.json()["detail"]
        app.dependency_overrides.clear()
