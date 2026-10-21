"""
Pydantic v2 response/request schemas.
These mirror the database tables and map cleanly onto the TypeScript types in
src/types/index.ts so the frontend can consume the API without extra adapters.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, ConfigDict


# ------------------------------------------------------------------ helpers
class _Base(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------ segments
class RoadSegmentResponse(_Base):
    id: UUID
    name: str
    safety_score: int = Field(ge=0, le=100)
    confidence_score: int = Field(ge=0, le=100)
    lighting_score: int = Field(ge=0, le=100)
    pedestrian_activity_score: int = Field(ge=0, le=100)
    emergency_access_score: int = Field(ge=0, le=100)
    emergency_access_label: Literal["Good", "Fair", "Limited"]
    time_condition: Optional[str]
    explanation: Optional[str]
    recent_reports_count: int
    # GeoJSON geometry — passed through as-is for the MapLibre frontend
    geometry: Optional[dict]
    updated_at: datetime


# ------------------------------------------------------------------ routes
class RouteResponse(_Base):
    id: UUID
    name: str
    route_type: Literal["fastest", "balanced", "safest"]
    distance_m: int
    duration_s: int
    safety_score: int = Field(ge=0, le=100)
    confidence: int = Field(ge=0, le=100)
    reason: Optional[str]
    segment_ids: list[UUID]
    recommended: bool
    geometry: Optional[dict]


# ------------------------------------------------------------------ reports
class ReportCreate(BaseModel):
    category: str
    description: Optional[str] = None
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    road_segment_id: Optional[UUID] = None
    severity: int = Field(default=1, ge=1, le=5)
    image_url: Optional[str] = None



class ReportResponse(_Base):
    id: UUID
    category: str
    description: Optional[str]
    latitude: float
    longitude: float
    status: str
    created_at: datetime


# ------------------------------------------------------------------ stories
class StoryCreate(BaseModel):
    content: str = Field(min_length=10, max_length=2000)
    place_name: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    road_segment_id: Optional[UUID] = None


class StoryResponse(_Base):
    id: UUID
    place_name: Optional[str]
    content: str
    tags: list[str]
    helpful_count: int
    created_at: datetime


# ------------------------------------------------------------------ help points
class HelpPointResponse(_Base):
    id: UUID
    name: str
    type: Literal["police", "hospital", "help"]
    latitude: float
    longitude: float
    address: Optional[str] = None
    phone: Optional[str] = None
    open_24h: bool = False
    opening_hours: Optional[str] = None
    distance_km: Optional[float] = None


# ------------------------------------------------------------------ common
class HealthResponse(BaseModel):
    status: str
    service: str