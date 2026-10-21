"""
Unit tests for image URL security, SSRF prevention, and Gemini Vision pipeline.
"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.services.vision import (
    validate_image_url_safety,
    detect_image_mime,
    fetch_safe_image_bytes,
    analyse_image,
    VisionAnalysis,
)


class TestImageSecurityAndSSRF:
    def test_loopback_address_rejected(self):
        safe, err = validate_image_url_safety("http://127.0.0.1/image.jpg")
        assert not safe
        assert "loopback" in (err or "").lower()

        safe, err = validate_image_url_safety("http://localhost/image.jpg")
        assert not safe
        assert "loopback" in (err or "").lower()

    def test_cloud_metadata_address_rejected(self):
        safe, err = validate_image_url_safety("http://169.254.169.254/latest/meta-data")
        assert not safe
        assert "metadata" in (err or "").lower()

    def test_private_subnets_rejected(self):
        safe, err = validate_image_url_safety("http://10.0.0.5/photo.png")
        assert not safe
        assert "private" in (err or "").lower()

        safe, err = validate_image_url_safety("http://192.168.1.100/photo.png")
        assert not safe
        assert "private" in (err or "").lower()

    def test_non_http_protocols_rejected(self):
        safe, err = validate_image_url_safety("file:///etc/passwd")
        assert not safe
        assert "scheme" in (err or "").lower()

        safe, err = validate_image_url_safety("ftp://example.com/photo.jpg")
        assert not safe
        assert "scheme" in (err or "").lower()

    def test_non_standard_port_rejected(self):
        safe, err = validate_image_url_safety("http://example.com:8080/image.jpg")
        assert not safe
        assert "port" in (err or "").lower()

    def test_magic_bytes_detection(self):
        jpeg_header = b"\xff\xd8\xff\xe0" + b"\x00" * 20
        assert detect_image_mime(jpeg_header) == "image/jpeg"

        png_header = b"\x89PNG\r\n\x1a\n" + b"\x00" * 20
        assert detect_image_mime(png_header) == "image/png"

        gif_header = b"GIF89a" + b"\x00" * 20
        assert detect_image_mime(gif_header) == "image/gif"

        webp_header = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 20
        assert detect_image_mime(webp_header) == "image/webp"

        non_image = b"Hello world non image binary"
        assert detect_image_mime(non_image) == "application/octet-stream"

    @pytest.mark.asyncio
    async def test_redirects_are_not_followed(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 302
        mock_resp.headers = {"Location": "http://169.254.169.254/"}

        with patch("app.services.vision.validate_image_url_safety", return_value=(True, None)):
            with patch("httpx.AsyncClient") as mc:
                client = AsyncMock()
                mc.return_value.__aenter__.return_value = client
                client.get = AsyncMock(return_value=mock_resp)

                bytes_out, ct, err = await fetch_safe_image_bytes("https://example.com/redirect")
                assert bytes_out is None
                assert "redirect" in (err or "").lower()

    @pytest.mark.asyncio
    async def test_mocked_gemini_vision_success(self):
        valid_json = (
            '{"lighting":"moderate","obstruction":"none","road_accessibility":"clear",'
            '"crowd_activity":"low","summary":"Well lit road with sidewalks","confidence":"high"}'
        )
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "candidates": [{
                "content": {
                    "parts": [{"text": valid_json}]
                }
            }]
        }

        with patch("httpx.AsyncClient") as mc:
            client = AsyncMock()
            mc.return_value.__aenter__.return_value = client
            client.post = AsyncMock(return_value=mock_resp)

            img_bytes = b"\xff\xd8\xff\xe0" + b"\x00" * 20
            analysis, err = await analyse_image(img_bytes, "image/jpeg", api_key="test-gemini-key")
            assert err is None
            assert analysis is not None
            assert analysis.lighting == "moderate"
            assert analysis.road_accessibility == "clear"
            assert analysis.confidence == "high"
