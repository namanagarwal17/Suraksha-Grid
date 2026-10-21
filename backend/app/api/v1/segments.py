from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from app.db.client import get_supabase
from app.schemas.models import RoadSegmentResponse
from app.services.data import get_all_segments, get_segment

router = APIRouter()

@router.get("/", response_model=list[RoadSegmentResponse])
async def list_segments(db=Depends(get_supabase)):
    """Return all road segments with safety scores and geometry."""
    return await get_all_segments(db)

@router.get("/{segment_id}", response_model=RoadSegmentResponse)
async def read_segment(segment_id: UUID, db=Depends(get_supabase)):
    """Return a single road segment by ID."""
    data = await get_segment(db, segment_id)
    if not data:
        raise HTTPException(status_code=404, detail="Segment not found")
    return data