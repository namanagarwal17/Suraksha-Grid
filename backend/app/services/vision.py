"""
Gemini Vision extension for the GeminiService.

Accepts a base64-encoded image and extracts ONLY safety-relevant signals:
- lighting level
- obstructions
- road accessibility
- visible crowd/activity level

Does NOT identify people, faces, license plates or infer sensitive attributes.
Does NOT produce a Safety Score — signals are fed to the Safety Engine.
"""
from __future__ import annotations

import base64
import ipaddress
import json
import logging
import socket
from typing import Literal, Optional
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


def validate_image_url_safety(url: str) -> tuple[bool, Optional[str]]:
    """
    Validate that an image URL does not target loopback, private subnets,
    link-local cloud metadata (e.g. 169.254.169.254), or non-HTTP protocols.
    """
    try:
        parsed = urlparse(url)
    except Exception as exc:
        return False, f"Malformed URL: {exc}"

    if parsed.scheme not in ("http", "https"):
        return False, "Invalid URL scheme: only HTTP and HTTPS are allowed"

    hostname = (parsed.hostname or "").strip().lower()
    if not hostname:
        return False, "Missing URL hostname"

    # Restrict ports to standard HTTP/HTTPS
    if parsed.port and parsed.port not in (80, 443):
        return False, f"Non-standard port {parsed.port} is not allowed"

    # Reject known sensitive hostnames
    blocked_hosts = {
        "localhost", "127.0.0.1", "::1",
        "169.254.169.254", "metadata.google.internal", "instance-data",
    }
    if hostname in blocked_hosts:
        return False, "Target points to loopback or cloud metadata address"

    # Resolve hostname to IP addresses and check all resolved IPs
    try:
        addr_info = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        return False, f"DNS resolution failed: {exc}"

    for family, _, _, _, sockaddr in addr_info:
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
            if (
                ip.is_private
                or ip.is_loopback
                or ip.is_link_local
                or ip.is_multicast
                or ip.is_reserved
                or ip.is_unspecified
            ):
                return False, f"Target resolves to private/internal IP address: {ip_str}"
        except ValueError:
            return False, f"Invalid IP address resolved: {ip_str}"

    return True, None


def detect_image_mime(b: bytes) -> str:
    """Validate image magic bytes."""
    if len(b) >= 3 and b[0:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(b) >= 8 and b[0:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(b) >= 6 and (b[0:6] == b"GIF87a" or b[0:6] == b"GIF89a"):
        return "image/gif"
    if len(b) >= 12 and b[0:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "image/webp"
    return "application/octet-stream"


async def fetch_safe_image_bytes(
    url: str,
    timeout_s: float = 10.0,
    max_bytes: int = MAX_IMAGE_SIZE,
) -> tuple[Optional[bytes], Optional[str], Optional[str]]:
    """
    Safely fetches image bytes from an untrusted URL.
    Returns (bytes, content_type, error_message).
    Protects against SSRF, redirects, oversized payloads, and slowloris.
    """
    is_safe, err = validate_image_url_safety(url)
    if not is_safe:
        return None, None, err

    try:
        async with httpx.AsyncClient(timeout=timeout_s, follow_redirects=False) as client:
            resp = await client.get(url)

        # Do not follow redirects for untrusted image URLs
        if resp.status_code in (301, 302, 303, 307, 308):
            return None, None, "Redirects are not followed for untrusted image URLs"

        if resp.status_code != 200:
            return None, None, f"Remote server returned HTTP {resp.status_code}"

        # Check content-length header if provided
        cl_header = resp.headers.get("content-length")
        if cl_header and cl_header.isdigit() and int(cl_header) > max_bytes:
            return None, None, f"Image exceeds maximum allowed size of {max_bytes} bytes"

        content = resp.content
        if len(content) > max_bytes:
            return None, None, f"Image exceeds maximum allowed size of {max_bytes} bytes"

        # Content type check + magic bytes verification
        raw_ct = resp.headers.get("content-type", "").split(";")[0].strip().lower()
        magic_ct = detect_image_mime(content)

        if magic_ct in ALLOWED_IMAGE_MIMES:
            final_ct = magic_ct
        elif raw_ct in ALLOWED_IMAGE_MIMES:
            final_ct = raw_ct
        else:
            return None, None, f"Unsupported or invalid image content type: {raw_ct}"

        return content, final_ct, None

    except httpx.TimeoutException:
        return None, None, "Request timed out while fetching image"
    except Exception as exc:
        return None, None, f"Could not fetch image: {exc}"

VISION_PROMPT = """\
You are a safety-signal extractor for a navigation app.

Analyse this image and return ONLY a JSON object with these fields:
{
  "lighting":            "low" | "moderate" | "good" | "unknown",
  "obstruction":         "none" | "partial" | "significant" | "unknown",
  "road_accessibility":  "clear" | "partially_blocked" | "blocked" | "unknown",
  "crowd_activity":      "empty" | "low" | "moderate" | "high" | "unknown",
  "summary":             "<one sentence describing safety-relevant observations>",
  "confidence":          "low" | "medium" | "high"
}

Rules:
- Do NOT identify, describe or name any people in the image.
- Do NOT include faces, names, demographics or personal attributes.
- Focus only on environment: lighting, infrastructure, obstructions.
- Return ONLY the JSON — no markdown, no explanation.
"""


class VisionAnalysis(BaseModel):
    lighting:           Literal["low", "moderate", "good", "unknown"] = "unknown"
    obstruction:        Literal["none", "partial", "significant", "unknown"] = "unknown"
    road_accessibility: Literal["clear", "partially_blocked", "blocked", "unknown"] = "unknown"
    crowd_activity:     Literal["empty", "low", "moderate", "high", "unknown"] = "unknown"
    summary:            str = Field(default="No visual summary available", max_length=500)
    confidence:         Literal["low", "medium", "high"] = "low"


async def analyse_image(
    image_bytes: bytes,
    mime_type: str,
    api_key: str,
    timeout_s: float = 10.0,
) -> tuple[VisionAnalysis | None, str | None]:
    """
    Returns (VisionAnalysis, error_message).
    error_message is None on success.
    VisionAnalysis is None on failure.
    Never identifies people or produces safety scores.
    """
    if not api_key:
        return None, "GEMINI_API_KEY not configured"

    # Validate mime type — accept only common image formats
    allowed = {"image/jpeg", "image/png", "image/webp", "image/gif"}
    if mime_type not in allowed:
        return None, f"Unsupported image type: {mime_type}"

    b64 = base64.b64encode(image_bytes).decode()
    payload = {
        "contents": [{
            "parts": [
                {"text": VISION_PROMPT},
                {"inline_data": {"mime_type": mime_type, "data": b64}},
            ]
        }],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 256},
    }
    GEMINI_URL = (
        "https://generativelanguage.googleapis.com/v1beta"
        "/models/gemini-1.5-flash:generateContent"
    )
    try:
        import httpx
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(
                f"{GEMINI_URL}?key={api_key}",
                json=payload,
                headers={"Content-Type": "application/json"},
            )
        resp.raise_for_status()
        raw: str = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        clean = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        parsed = json.loads(clean)
        return VisionAnalysis.model_validate(parsed), None
    except Exception as exc:
        logger.error("Vision analysis failed: %s", exc)
        return None, f"Vision analysis unavailable: {exc}"