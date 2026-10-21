"""Emergency alert API endpoint."""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from typing import Optional

from app.services.emergency import (
    EmergencyEvent,
    AlertResult,
    get_emergency_service,
    validate_and_prepare_voice_attachment,
)
from app.services.exotel import (
    ANNOUNCEMENT_EMAIL_SENT,
    ANNOUNCEMENT_EMAIL_FAILED,
)

router = APIRouter()


class EmergencyRequest(BaseModel):
    user_name:               str = Field(default="App User", max_length=120)
    latitude:                Optional[float] = Field(default=None, ge=-90, le=90)
    longitude:               Optional[float] = Field(default=None, ge=-180, le=180)
    destination:             Optional[str] = Field(default=None, max_length=200)
    route_name:              Optional[str] = Field(default=None, max_length=80)
    emergency_contact_email: Optional[str] = Field(default=None, max_length=254)
    emergency_contact_phone: Optional[str] = Field(default=None, max_length=30)
    voice_message_base64:    Optional[str] = Field(default=None)
    voice_message_mime_type: Optional[str] = Field(default=None, max_length=100)
    voice_message_filename:  Optional[str] = Field(default=None, max_length=100)
    idempotency_key:         Optional[str] = Field(default=None, max_length=100)


class EmergencyResponse(BaseModel):
    email_sent:             bool
    sms_sent:               bool
    sms_simulated:          bool
    map_link:               str
    location_available:     bool = True
    email_error:            Optional[str] = None
    sms_error:              Optional[str] = None
    voice_attached:         bool = False
    voice_error:            Optional[str] = None
    call_initiated:         bool = False
    call_sid:               Optional[str] = None
    call_status:            Optional[str] = None
    call_error:             Optional[str] = None
    call_announcement_type: Optional[str] = None


@router.post("/trigger", response_model=EmergencyResponse, status_code=200)
async def trigger_emergency(
    body: EmergencyRequest,
    x_user_id: Optional[str] = Header(default=None),
):
    """
    Dispatch an emergency safety alert.

    Email:  sent via Resend when RESEND_API_KEY is configured.
    Voice:  outbound call via Exotel playing short automated SOS announcement.
            Announcement informs whether location email was accepted.
    SMS:    SIMULATED in demo mode — DemoSmsProvider never delivers a real carrier SMS.
    Audio:  user voice recording attached to emergency email as playable audio.
    Safety Score is not recalculated here.
    """
    voice_att = None
    if body.voice_message_base64:
        att, err = validate_and_prepare_voice_attachment(
            b64_data=body.voice_message_base64,
            mime_type=body.voice_message_mime_type,
            filename=body.voice_message_filename,
        )
        if err:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=err,
            )
        voice_att = att

    svc = get_emergency_service()
    evt = EmergencyEvent(
        user_id=x_user_id,
        user_name=body.user_name,
        latitude=body.latitude,
        longitude=body.longitude,
        destination=body.destination,
        route_name=body.route_name,
        emergency_contact_email=body.emergency_contact_email,
        emergency_contact_phone=body.emergency_contact_phone,
        voice_attachment=voice_att,
        idempotency_key=body.idempotency_key,
    )
    result = await svc.dispatch(evt)
    return EmergencyResponse(
        email_sent             = result.email_sent,
        sms_sent               = result.sms_sent,
        sms_simulated          = result.sms_simulated,
        map_link               = result.map_link,
        location_available     = result.location_available,
        email_error            = result.email_error,
        sms_error              = result.sms_error,
        voice_attached         = result.voice_attached,
        voice_error            = result.voice_error,
        call_initiated         = result.call_initiated,
        call_sid               = result.call_sid,
        call_status            = result.call_status,
        call_error             = result.call_error,
        call_announcement_type = result.call_announcement_type,
    )


@router.get("/exotel-announcement", response_class=PlainTextResponse)
async def get_exotel_announcement(
    variant: str = Query(default="generic", description="'email_sent' or 'email_failed'/'generic'"),
    CustomField: Optional[str] = Query(default=None),
):
    """
    Dynamic announcement webhook endpoint for Exotel IVR flow / TTS applet.
    Returns plain text for Exotel's automated text-to-speech engine.
    Does NOT expose private coordinates or secrets.
    """
    field = (CustomField or variant or "generic").lower()
    if field in ("email_sent", "location_email_sent"):
        return PlainTextResponse(ANNOUNCEMENT_EMAIL_SENT, media_type="text/plain")
    return PlainTextResponse(ANNOUNCEMENT_EMAIL_FAILED, media_type="text/plain")