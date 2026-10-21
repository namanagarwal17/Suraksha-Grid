from fastapi import APIRouter, Depends, Header
from typing import Optional
from app.db.client import get_supabase
from app.schemas.models import StoryCreate, StoryResponse
from app.services.data import get_stories, create_story

router = APIRouter()

@router.get("/", response_model=list[StoryResponse])
async def list_stories(limit: int = 40, db=Depends(get_supabase)):
    """Return recent street stories."""
    return await get_stories(db, limit=min(limit, 100))

@router.post("/", response_model=StoryResponse, status_code=201)
async def submit_story(
    body: StoryCreate,
    db=Depends(get_supabase),
    x_user_id: Optional[str] = Header(default=None),
):
    data = body.model_dump(exclude_none=True)
    return await create_story(db, data, user_id=x_user_id)