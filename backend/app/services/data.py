"""
Service layer — data-access helpers used by the API routers.
All functions accept an optional supabase Client so they can be
tested with a mock. The routers inject the real client via Depends().
"""
from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

if TYPE_CHECKING:
    from supabase import Client


# ------------------------------------------------------------------ segments
async def get_all_segments(db: "Client") -> list[dict]:
    resp = (
        db.table("road_segments")
        .select(
            "id,name,safety_score,confidence_score,lighting_score,"
            "pedestrian_activity_score,emergency_access_score,"
            "emergency_access_label,time_condition,explanation,"
            "recent_reports_count,updated_at,geometry::json"
        )
        .limit(3000)
        .execute()
    )
    return resp.data or []


async def get_segment(db: "Client", segment_id: UUID) -> dict | None:
    resp = (
        db.table("road_segments")
        .select("*,geometry::json")
        .eq("id", str(segment_id))
        .maybe_single()
        .execute()
    )
    return resp.data


# ------------------------------------------------------------------ routes
async def get_all_routes(db: "Client") -> list[dict]:
    resp = (
        db.table("routes")
        .select(
            "id,name,route_type,distance_m,duration_s,safety_score,"
            "confidence,reason,segment_ids,recommended,geometry::json"
        )
        .order("safety_score", desc=True)
        .execute()
    )
    return resp.data or []


# ------------------------------------------------------------------ reports
async def create_report(db: "Client", data: dict, user_id: str | None) -> dict:
    payload = {**data, "user_id": user_id, "status": "pending"}
    resp = db.table("safety_reports").insert(payload).execute()
    if resp.data:
        # Increment the counter on the associated segment if provided
        seg_id = data.get("road_segment_id")
        if seg_id:
            db.rpc("increment_report_count", {"seg_id": seg_id}).execute()
    return resp.data[0] if resp.data else {}


async def get_reports(db: "Client", limit: int = 50) -> list[dict]:
    resp = (
        db.table("safety_reports")
        .select("id,category,description,latitude,longitude,status,created_at")
        .neq("status", "dismissed")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return resp.data or []


# ------------------------------------------------------------------ stories
async def get_stories(db: "Client", limit: int = 40) -> list[dict]:
    resp = (
        db.table("street_stories")
        .select("id,place_name,content,tags,helpful_count,created_at")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return resp.data or []


async def create_story(db: "Client", data: dict, user_id: str | None) -> dict:
    payload = {**data, "user_id": user_id}
    resp = db.table("street_stories").insert(payload).execute()
    return resp.data[0] if resp.data else {}


# ------------------------------------------------------------------ help
async def get_help_points(db: "Client") -> list[dict]:
    resp = db.table("help_points").select("*").execute()
    return resp.data or []