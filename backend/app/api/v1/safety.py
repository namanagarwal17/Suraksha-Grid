"""
Safety engine API endpoints.
POST /api/v1/safety/score   → single-segment score
POST /api/v1/safety/route   → route-level score
POST /api/v1/safety/anomaly → anomaly check
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.db.client import get_supabase
from app.services.safety_engine import (
    SafetyInput, ReportSignal,
    SegmentForScoring,
    calculate_safety_score,
    score_route,
    check_anomaly,
)

router = APIRouter()


# ------------------------------------------------------------------ schemas
class ReportSignalIn(BaseModel):
    category:  str
    severity:  int = Field(default=1, ge=1, le=5)
    age_hours: float = Field(ge=0)


class ScoreRequest(BaseModel):
    lighting:            float = Field(ge=0, le=100)
    pedestrian_activity: float = Field(ge=0, le=100)
    emergency_access:    str   = Field(pattern="^(Good|Fair|Limited)$")
    reports:             list[ReportSignalIn] = Field(default_factory=list)
    observation_hour:    Optional[int]        = Field(default=None, ge=0, le=23)
    has_lighting_sensor: bool = False
    has_cctv:            bool = False


class ScoreFactorsOut(BaseModel):
    lighting:            float
    pedestrian_activity: float
    report_penalty:      float
    severity_penalty:    float
    emergency_access:    float
    time_of_day:         float


class SafetyScoreResponse(BaseModel):
    safety_score:     int
    confidence_score: int
    factors:          ScoreFactorsOut
    risk_factors:     list[str]
    positive_factors: list[str]
    explanation:      str
    time_period:      str
    calculated_at:    datetime


class SegmentIn(BaseModel):
    id:           str
    safety_score: int = Field(ge=0, le=100)
    confidence:   int = Field(ge=0, le=100)
    length_km:    float = Field(default=0.5, ge=0)


class RouteScoreRequest(BaseModel):
    segments: list[SegmentIn]


class RouteSafetyResponse(BaseModel):
    safety_score:     int
    confidence_score: int
    risk_factors:     list[str]
    positive_factors: list[str]
    explanation:      str


class AnomalyRequest(BaseModel):
    reports: list[ReportSignalIn]


class AnomalyResponse(BaseModel):
    is_anomaly: bool
    severity:   str
    reason:     str


# ------------------------------------------------------------------ endpoints
@router.post("/score", response_model=SafetyScoreResponse)
async def compute_segment_score(body: ScoreRequest):
    """
    Calculate deterministic Safety Score + Confidence for a road segment.
    Score is an index 0–100, not a probability.
    """
    inp = SafetyInput(
        lighting              = body.lighting,
        pedestrian_activity   = body.pedestrian_activity,
        emergency_access      = body.emergency_access,
        reports               = [ReportSignal(**r.model_dump()) for r in body.reports],
        observation_hour      = body.observation_hour,
        has_lighting_sensor   = body.has_lighting_sensor,
        has_cctv              = body.has_cctv,
    )
    result = calculate_safety_score(inp)
    return SafetyScoreResponse(
        safety_score     = result.safety_score,
        confidence_score = result.confidence_score,
        factors          = ScoreFactorsOut(**result.factors.__dict__),
        risk_factors     = result.risk_factors,
        positive_factors = result.positive_factors,
        explanation      = result.explanation,
        time_period      = result.time_period,
        calculated_at    = result.calculated_at,
    )


@router.post("/route", response_model=RouteSafetyResponse)
async def compute_route_score(body: RouteScoreRequest):
    """
    Derive a route-level Safety Score from its constituent segments.
    Uses length-weighted scoring, not a simple average.
    """
    segs = [SegmentForScoring(**s.model_dump()) for s in body.segments]
    result = score_route(segs)
    return RouteSafetyResponse(**result.__dict__)


@router.post("/anomaly", response_model=AnomalyResponse)
async def detect_anomaly(body: AnomalyRequest):
    """
    Deterministic anomaly detection — report spikes and severity spikes.
    No ML. All logic is rule-based and auditable.
    """
    reports = [ReportSignal(**r.model_dump()) for r in body.reports]
    result = check_anomaly(reports)
    return AnomalyResponse(**result.__dict__)


@router.post("/recalculate/{segment_id}", response_model=SafetyScoreResponse)
async def recalculate_segment(segment_id: UUID, db=Depends(get_supabase)):
    """
    Fetch live segment + recent reports from Supabase and recompute scores.
    Persists updated scores via the upsert_segment_scores RPC.
    Falls back gracefully if the database is unavailable.
    """
    try:
        seg_resp = (
            db.table("road_segments")
            .select("id,lighting_score,pedestrian_activity_score,emergency_access_label")
            .eq("id", str(segment_id))
            .single()
            .execute()
        )
        seg = seg_resp.data
        if not seg:
            from fastapi import HTTPException
            raise HTTPException(404, "Segment not found")

        rep_resp = (
            db.table("safety_reports")
            .select("category,severity,created_at")
            .eq("road_segment_id", str(segment_id))
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

        inp = SafetyInput(
            lighting            = seg["lighting_score"],
            pedestrian_activity = seg["pedestrian_activity_score"],
            emergency_access    = seg["emergency_access_label"],
            reports             = reports,
        )
        result = calculate_safety_score(inp)

        # ── Historical crime evidence integration ─────────────────────────
        # Fetch segment geometry → route intersection → apply adjustment.
        # Historical evidence is NEVER sent to Gemini; it adjusts the
        # deterministic Safety Engine result only.
        # Missing evidence (UNAVAILABLE / NONE) leaves the score unchanged.
        try:
            from app.services.crime.spatial import (
                route_crime_intersections,
                check_dataset_available,
            )
            from app.services.crime.evidence import aggregate
            from app.services.safety_engine import apply_historical_evidence

            if await check_dataset_available(db):
                seg_geom_resp = (
                    db.table("road_segments")
                    .select("geometry::text, ST_Length(geometry::geography) as length_m")
                    .eq("id", str(segment_id))
                    .maybe_single()
                    .execute()
                )
                geom_data = seg_geom_resp.data or {}
                geom_wkt  = geom_data.get("geometry", "")
                seg_len_m = float(geom_data.get("length_m") or 0)

                if geom_wkt and seg_len_m > 0:
                    intersections = await route_crime_intersections(
                        db, geom_wkt, seg_len_m
                    )
                    evidence = aggregate(intersections, dataset_available=True)
                    if evidence.score_adjustment != 0.0:
                        result = apply_historical_evidence(
                            result,
                            evidence.score_adjustment,
                            evidence.explanation,
                        )
        except Exception as _exc:
            # Historical evidence failure must never break the primary score
            import logging as _log
            _log.getLogger(__name__).warning(
                "Historical evidence fetch failed for segment %s: %s", segment_id, _exc
            )

        # Persist back via the service-role RPC
        db.rpc("upsert_segment_scores", {
            "p_segment_id":          str(segment_id),
            "p_safety_score":        result.safety_score,
            "p_confidence_score":    result.confidence_score,
            "p_lighting_score":      round(inp.lighting),
            "p_pedestrian_activity": round(inp.pedestrian_activity),
            "p_explanation":         result.explanation,
        }).execute()

        return SafetyScoreResponse(
            safety_score     = result.safety_score,
            confidence_score = result.confidence_score,
            factors          = ScoreFactorsOut(**result.factors.__dict__),
            risk_factors     = result.risk_factors,
            positive_factors = result.positive_factors,
            explanation      = result.explanation,
            time_period      = result.time_period,
            calculated_at    = result.calculated_at,
        )
    except Exception as exc:
        # Database unavailable → return a calculated score without persistence
        from fastapi import HTTPException
        if "404" in str(exc):
            raise
        raise HTTPException(503, detail=f"Database unavailable: {exc}") from exc