"""
Deterministic unit tests for OpenRouteService (ORS) route fetching and processing.
Unit tests do NOT depend on live ORS availability and use mocked responses.
"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.services.ors import get_ors_routes, ORSError


def make_mock_feature(coords, duration=600, distance=1000):
    return {
        "type": "Feature",
        "geometry": {
            "type": "LineString",
            "coordinates": coords,
        },
        "properties": {
            "summary": {"duration": duration, "distance": distance},
        },
    }


class TestORSMultiRouteHandling:
    @pytest.mark.asyncio
    async def test_exactly_one_route(self, monkeypatch):
        monkeypatch.setenv("OPENROUTESERVICE_API_KEY", "test-key")
        feat1 = make_mock_feature([[77.0, 28.0], [77.01, 28.01]])
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"features": [feat1]}

        with patch("httpx.AsyncClient") as mc:
            client = AsyncMock()
            mc.return_value.__aenter__.return_value = client
            client.post = AsyncMock(return_value=mock_resp)

            routes = await get_ors_routes([77.0, 28.0], [77.01, 28.01])
            assert len(routes) == 1
            assert routes[0]["geometry"]["coordinates"] == feat1["geometry"]["coordinates"]

    @pytest.mark.asyncio
    async def test_exactly_two_routes(self, monkeypatch):
        monkeypatch.setenv("OPENROUTESERVICE_API_KEY", "test-key")
        feat1 = make_mock_feature([[77.0, 28.0], [77.01, 28.01]], duration=500)
        feat2 = make_mock_feature([[77.0, 28.0], [77.005, 28.015], [77.01, 28.01]], duration=700)
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"features": [feat1, feat2]}

        with patch("httpx.AsyncClient") as mc:
            client = AsyncMock()
            mc.return_value.__aenter__.return_value = client
            client.post = AsyncMock(return_value=mock_resp)

            routes = await get_ors_routes([77.0, 28.0], [77.01, 28.01])
            assert len(routes) == 2

    @pytest.mark.asyncio
    async def test_exactly_three_routes(self, monkeypatch):
        monkeypatch.setenv("OPENROUTESERVICE_API_KEY", "test-key")
        feat1 = make_mock_feature([[77.0, 28.0], [77.01, 28.01]], duration=400)
        feat2 = make_mock_feature([[77.0, 28.0], [77.005, 28.01], [77.01, 28.01]], duration=550)
        feat3 = make_mock_feature([[77.0, 28.0], [77.002, 28.012], [77.01, 28.01]], duration=650)
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"features": [feat1, feat2, feat3]}

        with patch("httpx.AsyncClient") as mc:
            client = AsyncMock()
            mc.return_value.__aenter__.return_value = client
            client.post = AsyncMock(return_value=mock_resp)

            routes = await get_ors_routes([77.0, 28.0], [77.01, 28.01])
            assert len(routes) == 3

    @pytest.mark.asyncio
    async def test_duplicate_routes_are_deduplicated(self, monkeypatch):
        monkeypatch.setenv("OPENROUTESERVICE_API_KEY", "test-key")
        # Identical geometry in both features
        coords = [[77.0, 28.0], [77.005, 28.005], [77.01, 28.01]]
        feat1 = make_mock_feature(coords, duration=500)
        feat2 = make_mock_feature(coords, duration=500)
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"features": [feat1, feat2]}

        with patch("httpx.AsyncClient") as mc:
            client = AsyncMock()
            mc.return_value.__aenter__.return_value = client
            client.post = AsyncMock(return_value=mock_resp)

            routes = await get_ors_routes([77.0, 28.0], [77.01, 28.01])
            # Duplicate was removed
            assert len(routes) == 1

    @pytest.mark.asyncio
    async def test_empty_response_raises_ors_error(self, monkeypatch):
        monkeypatch.setenv("OPENROUTESERVICE_API_KEY", "test-key")
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"features": []}

        with patch("httpx.AsyncClient") as mc:
            client = AsyncMock()
            mc.return_value.__aenter__.return_value = client
            client.post = AsyncMock(return_value=mock_resp)

            with pytest.raises(ORSError, match="no routes"):
                await get_ors_routes([77.0, 28.0], [77.01, 28.01])

    @pytest.mark.asyncio
    async def test_malformed_geometry_raises_ors_error(self, monkeypatch):
        monkeypatch.setenv("OPENROUTESERVICE_API_KEY", "test-key")
        # Feature with empty coordinates
        feat = {"type": "Feature", "geometry": {"type": "LineString", "coordinates": []}}
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"features": [feat]}

        with patch("httpx.AsyncClient") as mc:
            client = AsyncMock()
            mc.return_value.__aenter__.return_value = client
            client.post = AsyncMock(return_value=mock_resp)

            with pytest.raises(ORSError, match="no valid route features"):
                await get_ors_routes([77.0, 28.0], [77.01, 28.01])

    @pytest.mark.asyncio
    async def test_http_error_from_ors_raises_ors_error(self, monkeypatch):
        monkeypatch.setenv("OPENROUTESERVICE_API_KEY", "test-key")
        mock_resp = MagicMock()
        mock_resp.status_code = 429
        mock_resp.json.return_value = {"error": {"message": "Rate limit exceeded"}}

        with patch("httpx.AsyncClient") as mc:
            client = AsyncMock()
            mc.return_value.__aenter__.return_value = client
            client.post = AsyncMock(return_value=mock_resp)

            with pytest.raises(ORSError, match="Rate limit exceeded"):
                await get_ors_routes([77.0, 28.0], [77.01, 28.01])

    @pytest.mark.asyncio
    async def test_long_distance_omits_alternative_routes(self, monkeypatch):
        monkeypatch.setenv("OPENROUTESERVICE_API_KEY", "test-key")
        # Delhi to Jaipur ~240 km > 100 km limit
        delhi = [77.2090, 28.6139]
        jaipur = [75.7873, 26.9124]
        feat = make_mock_feature([delhi, [76.5, 27.5], jaipur], duration=18000, distance=240000)
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"features": [feat]}

        with patch("httpx.AsyncClient") as mc:
            client = AsyncMock()
            mc.return_value.__aenter__.return_value = client
            client.post = AsyncMock(return_value=mock_resp)

            routes = await get_ors_routes(delhi, jaipur, profile="driving-car")
            assert len(routes) == 1
            # Check payload had no alternative_routes
            calls = client.post.call_args_list
            assert len(calls) == 1
            sent_payload = calls[0].kwargs["json"]
            assert "alternative_routes" not in sent_payload
            assert sent_payload["coordinates"] == [delhi, jaipur]

    @pytest.mark.asyncio
    async def test_http_400_on_alternatives_retries_standard_directions(self, monkeypatch):
        monkeypatch.setenv("OPENROUTESERVICE_API_KEY", "test-key")
        origin = [77.0, 28.0]
        destination = [77.5, 28.5]
        # First response: 400 distance limit exceeded for alternatives
        err_resp = MagicMock()
        err_resp.status_code = 400
        err_resp.json.return_value = {
            "error": {"code": 2004, "message": "The distance between points should not exceed 100000 meters for alternative routes"}
        }

        # Second response: 200 standard directions
        success_feat = make_mock_feature([origin, [77.25, 28.25], destination], duration=5000, distance=80000)
        succ_resp = MagicMock()
        succ_resp.status_code = 200
        succ_resp.json.return_value = {"features": [success_feat]}

        with patch("httpx.AsyncClient") as mc:
            client = AsyncMock()
            mc.return_value.__aenter__.return_value = client
            client.post = AsyncMock(side_effect=[err_resp, succ_resp])

            routes = await get_ors_routes(origin, destination, profile="driving-car")
            assert len(routes) == 1
            # Verified client retried without alternative_routes
            assert client.post.call_count == 2
            fallback_payload = client.post.call_args_list[1].kwargs["json"]
            assert "alternative_routes" not in fallback_payload

    @pytest.mark.asyncio
    async def test_coordinate_order_lng_lat_preserved(self, monkeypatch):
        monkeypatch.setenv("OPENROUTESERVICE_API_KEY", "test-key")
        coords = [[77.100, 28.500], [77.105, 28.505], [77.110, 28.510]]
        feat = make_mock_feature(coords)
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"features": [feat]}

        with patch("httpx.AsyncClient") as mc:
            client = AsyncMock()
            mc.return_value.__aenter__.return_value = client
            client.post = AsyncMock(return_value=mock_resp)

            routes = await get_ors_routes([77.100, 28.500], [77.110, 28.510])
            route_coords = routes[0]["geometry"]["coordinates"]
            # First element is longitude (~77), second is latitude (~28)
            assert route_coords[0][0] == 77.100
            assert route_coords[0][1] == 28.500

