"""
Suraksha Grid — Emergency Alert Service
========================================

Flow:
  EmergencyEvent → EmailService (Resend) + SmsService (provider abstraction)

SMS:
  DemoSmsProvider  — always used unless a real provider is wired in.
  Clearly labelled SIMULATED. Never claims delivery.

Email:
  Resend provider via RESEND_API_KEY env var.
  Falls back gracefully when key is absent.

Safety Score is NOT recalculated here.
"""
from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from app.services.exotel import (
    ExotelVoiceService,
    get_exotel_service,
    ANNOUNCEMENT_EMAIL_SENT,
    ANNOUNCEMENT_EMAIL_FAILED,
)

logger = logging.getLogger(__name__)


# ── Data ─────────────────────────────────────────────────────────────────────

@dataclass
class EmergencyEvent:
    user_id:         Optional[str]
    user_name:       str
    latitude:        Optional[float] = None
    longitude:       Optional[float] = None
    timestamp:       datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    destination:     Optional[str] = None
    route_name:      Optional[str] = None
    emergency_contact_email: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    voice_attachment: Optional[dict] = None
    voice_message_base64: Optional[str] = None
    voice_message_mime_type: Optional[str] = None
    voice_message_filename: Optional[str] = None
    idempotency_key: Optional[str] = None


@dataclass
class AlertResult:
    email_sent:  bool
    sms_sent:    bool
    sms_simulated: bool
    email_error: Optional[str] = None
    sms_error:   Optional[str] = None
    map_link:    str = ""
    location_available: bool = True
    voice_attached: bool = False
    voice_error: Optional[str] = None
    call_initiated: bool = False
    call_sid: Optional[str] = None
    call_status: Optional[str] = None
    call_error: Optional[str] = None
    call_announcement_type: Optional[str] = None


# ── Voice attachment validation ──────────────────────────────────────────────

MAX_VOICE_MESSAGE_BYTES = int(os.environ.get("MAX_VOICE_MESSAGE_SIZE_BYTES", str(5 * 1024 * 1024)))  # 5MB default
ALLOWED_AUDIO_MIME_TYPES = {
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
    "audio/wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/x-m4a",
    "audio/aac",
}


def validate_and_prepare_voice_attachment(
    b64_data: Optional[str],
    mime_type: Optional[str] = None,
    filename: Optional[str] = None,
    max_bytes: int = MAX_VOICE_MESSAGE_BYTES,
) -> tuple[Optional[dict], Optional[str]]:
    """
    Validates audio data, mime type, and byte size.
    Returns (attachment_dict, error_message).
    Attachment dict structure for Resend:
      {"filename": "...", "content": "<clean_base64>", "content_type": "..."}
    """
    if b64_data is None:
        return None, None

    if not b64_data.strip():
        return None, "Voice message recording is empty (0 bytes)"

    raw_b64 = b64_data.strip()
    header_mime = None
    if raw_b64.startswith("data:") and ";base64," in raw_b64:
        meta, raw_b64 = raw_b64.split(";base64,", 1)
        header_mime = meta[5:].strip().lower()

    # Determine base mime type
    candidate_mime = (mime_type or header_mime or "audio/webm").split(";")[0].strip().lower()
    if candidate_mime not in ALLOWED_AUDIO_MIME_TYPES:
        return None, (
            f"Unsupported audio MIME type: '{candidate_mime}'. "
            f"Allowed types: {', '.join(sorted(ALLOWED_AUDIO_MIME_TYPES))}"
        )

    # Decode base64
    import base64
    try:
        audio_bytes = base64.b64decode(raw_b64, validate=True)
    except Exception:
        return None, "Invalid base64 encoding for voice message audio"

    if len(audio_bytes) == 0:
        return None, "Voice message recording is empty (0 bytes)"

    if len(audio_bytes) > max_bytes:
        max_mb = max_bytes / (1024 * 1024)
        actual_mb = len(audio_bytes) / (1024 * 1024)
        return None, (
            f"Voice message size ({actual_mb:.2f} MB) exceeds maximum allowed size ({max_mb:.1f} MB)"
        )

    extension_map = {
        "audio/webm": ".webm",
        "audio/ogg": ".ogg",
        "audio/mp4": ".m4a",
        "audio/wav": ".wav",
        "audio/mpeg": ".mp3",
        "audio/mp3": ".mp3",
        "audio/x-m4a": ".m4a",
        "audio/aac": ".aac",
    }
    ext = extension_map.get(candidate_mime, ".webm")
    base_name = filename.strip() if filename else f"emergency_voice_message{ext}"
    safe_filename = os.path.basename(base_name)
    if not safe_filename.endswith(ext):
        safe_filename = f"{os.path.splitext(safe_filename)[0]}{ext}"

    clean_b64 = base64.b64encode(audio_bytes).decode("ascii")

    return {
        "filename": safe_filename,
        "content": clean_b64,
        "content_type": candidate_mime,
    }, None


# ── SMS abstraction ───────────────────────────────────────────────────────────

class SmsProvider(ABC):
    @abstractmethod
    async def send(self, to: str, body: str) -> tuple[bool, Optional[str]]:
        """Returns (success, error_message)."""


class DemoSmsProvider(SmsProvider):
    """
    Demonstration SMS provider.

    SIMULATED — no real SMS is ever sent.
    Clearly labelled in all log output and responses.
    """
    async def send(self, to: str, body: str) -> tuple[bool, Optional[str]]:
        logger.warning(
            "[DEMO/SIMULATED] SMS NOT sent to %s. "
            "Body would have been: %s",
            to, body,
        )
        # Intentionally does not claim delivery
        return True, "SIMULATED — no real SMS was sent"


def get_sms_provider() -> SmsProvider:
    """
    Returns a real SMS provider when one is configured, otherwise DemoSmsProvider.
    Add real provider implementations here when integrating Twilio / Fast2SMS / etc.
    """
    # Future: if os.environ.get("TWILIO_ACCOUNT_SID"): return TwilioSmsProvider()
    return DemoSmsProvider()


# ── Email (Resend) ────────────────────────────────────────────────────────────

def _map_link(lat: float, lng: float) -> str:
    return f"https://www.google.com/maps?q={lat},{lng}"


def _email_body(evt: EmergencyEvent, link: str) -> str:
    dest = evt.destination or "unknown destination"
    route = evt.route_name or "unknown route"
    loc_str = (
        f"{evt.latitude:.5f}, {evt.longitude:.5f}\nMap:         {link}"
        if evt.latitude is not None and evt.longitude is not None and link
        else "Location unavailable (GPS coordinates not provided)\nMap:         Not available"
    )
    voice_note = (
        f"A recorded voice message is attached ({evt.voice_attachment.get('filename', 'voice_message')})."
        if evt.voice_attachment
        else "No voice message was recorded."
    )
    return f"""SURAKSHA GRID — EMERGENCY SAFETY ALERT

User:        {evt.user_name}
Time (UTC):  {evt.timestamp.strftime("%Y-%m-%d %H:%M:%S")}
Location:    {loc_str}
Destination: {dest}
Route:       {route}
Voice Note:  {voice_note}

---
This alert was triggered from the Suraksha Grid safety navigation app.
If this was a test or accidental trigger, no action is required.
"""


async def _send_resend_email(
    to: str,
    subject: str,
    body: str,
    api_key: str,
    attachments: Optional[list[dict]] = None,
) -> tuple[bool, Optional[str]]:
    try:
        import httpx
        payload = {
            "from": "Suraksha Grid <onboarding@resend.dev>",
            "to":      [to],
            "subject": subject,
            "text":    body,
        }
        if attachments:
            payload["attachments"] = attachments

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            )
        if resp.status_code in (200, 201):
            return True, None
        return False, f"Resend HTTP {resp.status_code}: {resp.text[:200]}"
    except Exception as exc:
        return False, str(exc)


# ── Main service ──────────────────────────────────────────────────────────────

class EmergencyService:
    def __init__(self, exotel_service: Optional[ExotelVoiceService] = None) -> None:
        self._sms = get_sms_provider()
        self._exotel = exotel_service or get_exotel_service()
        self._recent_dispatches: dict[str, tuple[float, AlertResult]] = {}
        self._dedup_window_sec = 45.0

    @property
    def _resend_key(self) -> str:
        return os.environ.get("RESEND_API_KEY", "")

    async def dispatch(self, evt: EmergencyEvent) -> AlertResult:
        # ── Duplicate SOS dispatch protection ─────────────────────────────────
        dedup_key = (
            evt.idempotency_key.strip()
            if evt.idempotency_key and evt.idempotency_key.strip()
            else f"{evt.emergency_contact_phone or ''}:{evt.emergency_contact_email or ''}"
        )
        now_ts = datetime.now(timezone.utc).timestamp()
        if dedup_key and dedup_key in self._recent_dispatches:
            cached_time, cached_result = self._recent_dispatches[dedup_key]
            if now_ts - cached_time < self._dedup_window_sec:
                logger.warning(
                    "Duplicate SOS dispatch suppressed within %.1fs cooldown window (key=%s)",
                    self._dedup_window_sec,
                    dedup_key,
                )
                return cached_result

        has_location = evt.latitude is not None and evt.longitude is not None
        link = _map_link(evt.latitude, evt.longitude) if has_location else ""

        # Validate voice message if provided as raw base64 and not yet prepared
        voice_err = None
        if not evt.voice_attachment and evt.voice_message_base64:
            att, err = validate_and_prepare_voice_attachment(
                b64_data=evt.voice_message_base64,
                mime_type=evt.voice_message_mime_type,
                filename=evt.voice_message_filename,
            )
            evt.voice_attachment = att
            voice_err = err

        has_voice = evt.voice_attachment is not None

        result = AlertResult(
            email_sent=False,
            sms_sent=False,
            sms_simulated=isinstance(self._sms, DemoSmsProvider),
            map_link=link,
            location_available=has_location,
            voice_attached=False,
            voice_error=voice_err,
            call_initiated=False,
            call_sid=None,
            call_status=None,
            call_error=None,
            call_announcement_type=None,
        )

        # ── Step 1: Attempt Emergency Location Email (Resend) ─────────────────
        to_email = evt.emergency_contact_email
        if to_email:
            if not self._resend_key:
                result.email_error = "RESEND_API_KEY not configured"
                logger.warning("Email skipped: RESEND_API_KEY absent")
            else:
                subject = f"⚠️ SAFETY ALERT — {evt.user_name} needs help"
                body = _email_body(evt, link)
                attachments = [evt.voice_attachment] if evt.voice_attachment else None
                ok, err = await _send_resend_email(
                    to_email, subject, body, self._resend_key, attachments=attachments
                )
                result.email_sent = ok
                result.email_error = err
                if ok and has_voice:
                    result.voice_attached = True
                elif not ok and has_voice and not result.voice_error:
                    result.voice_error = f"Voice message failed to send: {err}"
        else:
            result.email_error = "No emergency contact email configured"

        # ── Step 2: Attempt Exotel Voice Call with Coordinated Announcement ───
        # Announcement variant depends honestly on whether email was accepted
        to_phone = evt.emergency_contact_phone
        if to_phone:
            call_res = await self._exotel.initiate_emergency_call(
                to_phone=to_phone,
                email_sent=result.email_sent,
                user_name=evt.user_name,
            )
            result.call_initiated = call_res.initiated
            result.call_sid = call_res.call_sid
            result.call_status = call_res.status
            result.call_error = call_res.error
            result.call_announcement_type = call_res.announcement_type
        else:
            result.call_status = "no_phone"
            result.call_error = "No emergency contact phone configured"

        # ── Step 3: SMS (Simulated demo mode) ─────────────────────────────────
        if to_phone:
            loc_desc = f"Last location: {link}" if link else "Location unavailable"
            voice_note = " (voice message sent via email)" if has_voice else ""
            sms_body = (
                f"SAFETY ALERT: {evt.user_name} may need help. "
                f"{loc_desc}{voice_note} at {evt.timestamp.strftime('%H:%M UTC')}"
            )
            ok, err = await self._sms.send(to_phone, sms_body)
            result.sms_sent = ok
            result.sms_error = err
        else:
            result.sms_error = "No emergency contact phone configured"

        # Record in dedup cache
        if dedup_key:
            self._recent_dispatches[dedup_key] = (now_ts, result)

        return result


_service: EmergencyService | None = None

def get_emergency_service() -> EmergencyService:
    global _service
    if _service is None:
        _service = EmergencyService()
    return _service