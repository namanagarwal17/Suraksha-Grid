"""
Reports API — integrates Gemini analysis, community evidence,
and the Safety Engine recalculation pathway.
"""
from __future__ import annotations

import os
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
import logging

from app.db.client import get_supabase
from app.schemas.models import ReportCreate, ReportResponse
from app.services.data import create_report, get_reports
from app.services.gemini_service import get_gemini_service
from app.services.safety_engine import (
    SafetyInput, ReportSignal, calculate_safety_score,
)
from app.services import vision as vision_svc

logger = logging.getLogger(__name__)
router = APIRouter()


class AnalysedReportCreate(ReportCreate):
    """Extended report that accepts free-form text for Gemini analysis."""
    original_text: Optional[str] = Field(default=None, max_length=2000)
    language: Optional[str] = Field(default=None, max_length=20)



def get_verified_user_id(
    authorization: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None),
    db=Depends(get_supabase),
) -> Optional[str]:
    """
    Derives authenticated identity strictly from validated Supabase access token.
    Never trusts client-provided x-user-id header without valid token matching.
    """
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split("Bearer ", 1)[1].strip()
        try:
            user_resp = db.auth.get_user(token)
            if not user_resp or not getattr(user_resp, "user", None):
                raise HTTPException(status_code=401, detail="Invalid or expired authentication token")
            verified_id = str(user_resp.user.id)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=401, detail=f"Authentication token verification failed: {exc}")

        if x_user_id and x_user_id != verified_id:
            raise HTTPException(status_code=403, detail="Spoofed user ID does not match authenticated token")
        return verified_id

    # If client passed x-user-id without a valid Authorization Bearer token:
    if x_user_id:
        raise HTTPException(
            status_code=401,
            detail="Authentication token required: client-provided user ID cannot be trusted without token",
        )

    # Guest user (no claimed identity)
    return None


def require_verified_user_id(
    user_id: Optional[str] = Depends(get_verified_user_id),
) -> str:
    """Strictly requires a verified authenticated user."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user_id


class AnalysedReportResponse(BaseModel):
    report: ReportResponse
    gemini_used: bool
    gemini_error: Optional[str] = None
    # Structured signals Gemini extracted (not a score)
    extracted_category: Optional[str] = None
    extracted_severity: Optional[int] = None
    extracted_lighting: Optional[str] = None
    extracted_time_context: Optional[str] = None
    summary: Optional[str] = None


@router.get("/", response_model=list[ReportResponse])
async def list_reports(limit: int = 50, db=Depends(get_supabase)):
    """Return recent non-dismissed safety reports."""
    return await get_reports(db, limit=min(limit, 200))


@router.post("/", response_model=AnalysedReportResponse, status_code=201)
async def submit_report(
    body: AnalysedReportCreate,
    db=Depends(get_supabase),
    user_id: Optional[str] = Depends(get_verified_user_id),
):
    """
    Submit a safety report.

    Flow:
      1. Validate input
      2. If original_text provided → Gemini analysis → structured signals
      3. Gemini failure is non-fatal; report still saved
      4. Store in Supabase
      5. Trigger safety recalculation for affected segment
    """
    gemini_result = None
    gemini_used   = False
    gemini_error: Optional[str] = None

    # ── 1. Gemini analysis (if text provided) ──────────────────────────────
    if body.original_text:
        svc = get_gemini_service()
        gemini_result = await svc.analyse(body.original_text)
        gemini_used   = gemini_result.gemini_used
        gemini_error  = gemini_result.error

        if gemini_result.analysis:
            # Override category/severity with Gemini's structured output
            # when they are more informative than the client-selected values.
            a = gemini_result.analysis
            if a.severity > body.severity:
                body = body.model_copy(update={"severity": a.severity})

    # ── 2. Persist report ──────────────────────────────────────────────────
    data = body.model_dump(exclude_none=True, exclude={"original_text","language"})
    saved = await create_report(db, data, user_id=user_id)

    report_resp = ReportResponse(
        id          = saved.get("id", ""),
        category    = saved.get("category", body.category),
        description = saved.get("description"),
        latitude    = saved.get("latitude", body.latitude),
        longitude   = saved.get("longitude", body.longitude),
        status      = saved.get("status", "pending"),
        created_at  = saved.get("created_at", ""),
    )

    # ── 3. Async recalculation (fire-and-forget; never blocks the response) ──
    seg_id = body.road_segment_id
    if seg_id:
        try:
            await _trigger_recalculation(db, str(seg_id))
        except Exception as exc:
            logger.warning("Recalculation skipped: %s", exc)

    return AnalysedReportResponse(
        report               = report_resp,
        gemini_used          = gemini_used,
        gemini_error         = gemini_error,
        extracted_category   = gemini_result.analysis.category   if gemini_result else None,
        extracted_severity   = gemini_result.analysis.severity   if gemini_result else None,
        extracted_lighting   = gemini_result.analysis.lighting   if gemini_result else None,
        extracted_time_context = gemini_result.analysis.time_context if gemini_result else None,
        summary              = gemini_result.analysis.summary    if gemini_result else None,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Vision image analysis endpoint
# POST /api/v1/reports/{report_id}/analyse-image
# ─────────────────────────────────────────────────────────────────────────────

class ImageAnalyseRequest(BaseModel):
    """URL of the already-uploaded image (Supabase signed URL or public URL)."""
    image_url: str = Field(..., min_length=8)


class ImageAnalyseResponse(BaseModel):
    report_id: str
    vision_used: bool
    vision_error: Optional[str] = None
    lighting: Optional[str] = None
    obstruction: Optional[str] = None
    road_accessibility: Optional[str] = None
    crowd_activity: Optional[str] = None
    summary: Optional[str] = None
    confidence: Optional[str] = None


@router.post("/{report_id}/analyse-image", response_model=ImageAnalyseResponse)
async def analyse_report_image(
    report_id: str,
    body: ImageAnalyseRequest,
    db=Depends(get_supabase),
    user_id: str = Depends(require_verified_user_id),
):
    """
    Fetch the image at `image_url`, run Gemini Vision analysis, and patch
    the safety_reports row with the extracted environmental signals.

    - Does NOT produce a safety score.
    - Vision failure is non-fatal: returns vision_used=False with error detail.
    - Verifies the report exists and verifies report ownership before analysing.
    """
    # Verify report exists and enforce ownership
    resp = (
        db.table("safety_reports")
        .select("id,user_id")
        .eq("id", report_id)
        .maybe_single()
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Report not found")
    report_row = resp.data
    if report_row.get("user_id") and report_row.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Forbidden: you do not own this report")

    # Fetch image safely: enforces scheme, ports, non-private DNS check, redirect refusal, and size limits
    image_bytes, content_type, fetch_err = await vision_svc.fetch_safe_image_bytes(body.image_url)
    if fetch_err or not image_bytes:
        return ImageAnalyseResponse(
            report_id=report_id,
            vision_used=False,
            vision_error=fetch_err or "Could not fetch image for analysis.",
        )

    # Run Gemini Vision
    api_key = os.environ.get("GEMINI_API_KEY", "")
    analysis, error = await vision_svc.analyse_image(image_bytes, content_type or "image/jpeg", api_key)

    if error or not analysis:
        return ImageAnalyseResponse(
            report_id=report_id,
            vision_used=False,
            vision_error=error or "Unknown vision error",
        )

    # Persist vision signals to the report row (best-effort)
    try:
        db.table("safety_reports").update({
            "image_url":        body.image_url,
            "vision_lighting":  analysis.lighting,
            "vision_obstruction": analysis.obstruction,
            "vision_crowd_activity": analysis.crowd_activity,
            "vision_summary":   analysis.summary,
            "vision_confidence": analysis.confidence,
        }).eq("id", report_id).execute()
    except Exception as exc:
        logger.warning("Could not persist vision signals: %s", exc)

    return ImageAnalyseResponse(
        report_id=report_id,
        vision_used=True,
        lighting=analysis.lighting,
        obstruction=analysis.obstruction,
        road_accessibility=analysis.road_accessibility,
        crowd_activity=analysis.crowd_activity,
        summary=analysis.summary,
        confidence=analysis.confidence,
    )


async def _trigger_recalculation(db, segment_id: str) -> None:
    """
    Fetch current segment signals + recent reports → Safety Engine → persist.
    Called internally after a report is saved.
    Does NOT fake the result. Raises on DB errors so the caller can log/skip.
    """
    from datetime import datetime, timezone

    seg_resp = (
        db.table("road_segments")
        .select("id,lighting_score,pedestrian_activity_score,emergency_access_label")
        .eq("id", segment_id)
        .single()
        .execute()
    )
    seg = seg_resp.data
    if not seg:
        raise ValueError(f"Segment {segment_id} not found")

    rep_resp = (
        db.table("safety_reports")
        .select("category,severity,created_at")
        .eq("road_segment_id", segment_id)
        .neq("status", "dismissed")
        .execute()
    )
    now = datetime.now(timezone.utc)
    reports = [
        ReportSignal(
            category  = r["category"],
            severity  = r["severity"],
            age_hours = (now - datetime.fromisoformat(r["created_at"])).total_seconds() / 3600,
        )
        for r in (rep_resp.data or [])
    ]

    inp    = SafetyInput(
        lighting            = seg["lighting_score"],
        pedestrian_activity = seg["pedestrian_activity_score"],
        emergency_access    = seg["emergency_access_label"],
        reports             = reports,
    )
    result = calculate_safety_score(inp)

    db.rpc("upsert_segment_scores", {
        "p_segment_id":          segment_id,
        "p_safety_score":        result.safety_score,
        "p_confidence_score":    result.confidence_score,
        "p_lighting_score":      round(inp.lighting),
        "p_pedestrian_activity": round(inp.pedestrian_activity),
        "p_explanation":         result.explanation,
    }).execute()