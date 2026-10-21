"""
Suraksha Grid — Exotel Outbound Voice Calling Service
=====================================================

Provides isolated, server-side outbound voice calling integration with Exotel.
Handles outbound emergency alerts, announcements (email accepted vs failed),
provider error mapping, retry bounds, and missing configuration reporting.

Never exposes credentials or API secrets.
Never claims answered/completed status unless reported by Exotel.
"""
from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

# Announcements specified by requirements
ANNOUNCEMENT_EMAIL_SENT = (
    "Emergency alert from Suraksha Grid. Your trusted contact has triggered an SOS emergency alert. "
    "Please check the location link sent to your registered email address and contact them immediately."
)

ANNOUNCEMENT_EMAIL_FAILED = (
    "Emergency alert from Suraksha Grid. Your trusted contact has triggered an SOS emergency alert. "
    "Please contact them immediately. Their location could not be confirmed through this alert."
)


def mask_phone_number(phone: str) -> str:
    """Mask phone number for safe logging (e.g., +91******3210)."""
    if not phone or len(phone) < 6:
        return "***"
    return phone[:3] + "*" * (len(phone) - 7) + phone[-4:] if len(phone) >= 10 else phone[:2] + "****"


def normalize_phone_number(phone: str) -> str:
    """Normalize phone number to standard format with country code."""
    cleaned = re.sub(r"[^\d+]", "", phone.strip())
    if cleaned.startswith("+"):
        return cleaned
    if cleaned.startswith("0") and len(cleaned) == 11:
        return "+91" + cleaned[1:]
    if len(cleaned) == 10 and cleaned[0] in "6789":
        return "+91" + cleaned
    if len(cleaned) == 12 and cleaned.startswith("91"):
        return "+" + cleaned
    return cleaned


@dataclass
class ExotelCallResult:
    initiated: bool
    call_sid: Optional[str] = None
    status: Optional[str] = None
    error: Optional[str] = None
    announcement_type: Optional[str] = None


class ExotelVoiceService:
    """
    Exotel Voice v1 Outbound Call Provider.

    Uses HTTP Basic Authentication:
      Username: EXOTEL_API_KEY
      Password: EXOTEL_API_TOKEN

    Endpoint:
      POST https://{EXOTEL_SUBDOMAIN}/v1/Accounts/{EXOTEL_ACCOUNT_SID}/Calls/connect.json
    """

    def __init__(self) -> None:
        pass

    @property
    def account_sid(self) -> str:
        # Default hint provided in dashboard: surakshagrid1
        return os.environ.get("EXOTEL_ACCOUNT_SID", "surakshagrid1").strip()

    @property
    def api_key(self) -> str:
        return os.environ.get("EXOTEL_API_KEY", "").strip()

    @property
    def api_token(self) -> str:
        return os.environ.get("EXOTEL_API_TOKEN", "").strip()

    @property
    def caller_id(self) -> str:
        # Assigned Exotel Virtual Number (ExoPhone)
        return os.environ.get("EXOTEL_CALLER_ID", "").strip()

    @property
    def subdomain(self) -> str:
        # Singapore cluster default displayed on dashboard: api.exotel.com
        # Mumbai cluster alternative: api.in.exotel.com
        return os.environ.get("EXOTEL_SUBDOMAIN", "api.exotel.com").strip()

    @property
    def app_id(self) -> str:
        return os.environ.get("EXOTEL_APP_ID", "").strip()

    @property
    def app_id_email_sent(self) -> str:
        return os.environ.get("EXOTEL_APP_ID_EMAIL_SENT", "").strip()

    @property
    def app_id_email_failed(self) -> str:
        return os.environ.get("EXOTEL_APP_ID_EMAIL_FAILED", "").strip()

    @property
    def flow_url(self) -> str:
        return os.environ.get("EXOTEL_FLOW_URL", "").strip()

    def get_missing_configuration(self) -> list[str]:
        """Check required environment variables and return missing list."""
        missing = []
        if not self.account_sid:
            missing.append("EXOTEL_ACCOUNT_SID")
        if not self.api_key:
            missing.append("EXOTEL_API_KEY")
        if not self.api_token:
            missing.append("EXOTEL_API_TOKEN")
        if not self.caller_id:
            missing.append("EXOTEL_CALLER_ID")
        if not (self.app_id or self.flow_url or self.app_id_email_sent or self.app_id_email_failed):
            missing.append("EXOTEL_APP_ID")
        return missing

    def is_configured(self) -> bool:
        return len(self.get_missing_configuration()) == 0

    def resolve_flow_url(self, email_sent: bool) -> str:
        """
        Determines the ExML / Flow URL to invoke for the automated announcement.
        """
        if self.flow_url:
            return self.flow_url

        target_app = (
            self.app_id_email_sent if (email_sent and self.app_id_email_sent)
            else self.app_id_email_failed if (not email_sent and self.app_id_email_failed)
            else self.app_id
        )

        if not target_app:
            return ""

        # Official Exotel ExML Applet URL format
        return (
    f"http://my.exotel.com/{self.account_sid}"
    f"/exoml/start_voice/{target_app}"
)

    async def initiate_emergency_call(
        self,
        to_phone: str,
        email_sent: bool,
        user_name: Optional[str] = None,
    ) -> ExotelCallResult:
        """
        Initiate an outbound emergency call to the trusted contact.

        Selects the announcement variant according to email delivery status.
        Never retries on client errors (4xx).
        Bounded retry (max 1) for transient network timeouts or 5xx errors.
        """
        if not to_phone or not to_phone.strip():
            return ExotelCallResult(
                initiated=False,
                status="no_phone",
                error="No trusted contact phone number provided",
            )

        missing_configs = self.get_missing_configuration()
        if missing_configs:
            msg = f"Voice calling not configured on server (Missing {', '.join(missing_configs)})"
            logger.info("Exotel voice call skipped: %s", msg)
            return ExotelCallResult(
                initiated=False,
                status="not_configured",
                error=msg,
            )

        target_url = self.resolve_flow_url(email_sent)
        if not target_url:
            msg = "Exotel flow URL or App ID could not be resolved"
            logger.warning("Exotel voice call failed: %s", msg)
            return ExotelCallResult(
                initiated=False,
                status="not_configured",
                error=msg,
            )

        normalized_phone = normalize_phone_number(to_phone)
        announcement_type = "location_email_sent" if email_sent else "generic_alert"
        custom_field = "email_sent" if email_sent else "email_failed"

        masked = mask_phone_number(normalized_phone)
        logger.info(
            "Initiating Exotel emergency voice call to %s (announcement: %s)",
            masked,
            announcement_type,
        )

        api_endpoint = f"https://{self.subdomain}/v1/Accounts/{self.account_sid}/Calls/connect.json"

        payload = {
            "From": normalized_phone,
            "CallerId": self.caller_id,
            "Url": target_url,
            "CallType": "trans",
            "CustomField": custom_field,
            "TimeLimit": "300",
            "TimeOut": "35",
        }

        # Safe bounded retry loop (max 1 retry for transient network failure or 5xx)
        max_attempts = 2
        last_error: Optional[str] = None
        last_status = "failed"

        for attempt in range(1, max_attempts + 1):
            try:
                import httpx
                async with httpx.AsyncClient(timeout=12.0) as client:
                    resp = await client.post(
                        api_endpoint,
                        auth=(self.api_key, self.api_token),
                        data=payload,
                    )

                if resp.status_code in (200, 201):
                    data = resp.json()
                    call_data = data.get("Call") or {}
                    sid = call_data.get("Sid")
                    call_status = call_data.get("Status", "queued")
                    logger.info(
                        "Exotel call accepted: CallSid=%s, Status=%s",
                        sid,
                        call_status,
                    )
                    return ExotelCallResult(
                        initiated=True,
                        call_sid=sid,
                        status=call_status,
                        error=None,
                        announcement_type=announcement_type,
                    )

                # Handle HTTP errors from Exotel
                status_code = resp.status_code
                if status_code == 401:
                    return ExotelCallResult(
                        initiated=False,
                        status="authentication_error",
                        error="Exotel authentication failed (HTTP 401): Check EXOTEL_API_KEY and EXOTEL_API_TOKEN",
                    )
                if status_code == 403:
                    # Account permission / KYC / credits error
                    detail = self._extract_error_detail(resp)
                    return ExotelCallResult(
                        initiated=False,
                        status="account_permission_error",
                        error=f"Exotel permission error (HTTP 403): {detail or 'Outbound calling permissions or KYC pending'}",
                    )
                if status_code == 429:
                    return ExotelCallResult(
                        initiated=False,
                        status="rate_limited",
                        error="Exotel rate limit reached (HTTP 429)",
                    )
                if 400 <= status_code < 500:
                    detail = self._extract_error_detail(resp)
                    return ExotelCallResult(
                        initiated=False,
                        status="failed",
                        error=f"Exotel rejected call request (HTTP {status_code}): {detail}",
                    )

                # 5xx server error: eligible for retry
                last_status = "provider_error"
                last_error = f"Exotel provider server error (HTTP {status_code})"
                logger.warning(
                    "Exotel attempt %d failed with status %d: %s",
                    attempt,
                    status_code,
                    last_error,
                )

            except Exception as exc:
                last_status = "network_error"
                last_error = f"Network error connecting to Exotel: {type(exc).__name__}"
                logger.warning("Exotel attempt %d exception: %s", attempt, str(exc))

            if attempt < max_attempts:
                import asyncio
                await asyncio.sleep(0.5)

        return ExotelCallResult(
            initiated=False,
            status=last_status,
            error=last_error or "Exotel voice call could not be completed",
        )

    @staticmethod
    def _extract_error_detail(resp) -> str:
        """Safely extract error message without exposing credentials."""
        try:
            data = resp.json()
            if isinstance(data, dict):
                if "RestException" in data and isinstance(data["RestException"], dict):
                    return data["RestException"].get("Message", "")
                if "response" in data and isinstance(data["response"], dict):
                    err_data = data["response"].get("error_data") or {}
                    return err_data.get("description") or err_data.get("message") or ""
                if "error" in data:
                    return str(data["error"])
        except Exception:
            pass
        return resp.text[:120].strip() if resp.text else ""


_exotel_service: Optional[ExotelVoiceService] = None


def get_exotel_service() -> ExotelVoiceService:
    global _exotel_service
    if _exotel_service is None:
        _exotel_service = ExotelVoiceService()
    return _exotel_service
