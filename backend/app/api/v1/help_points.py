from fastapi import APIRouter, Depends, HTTPException, Query
from app.schemas.models import HelpPointResponse
from app.services.help import get_nearby_places

router = APIRouter()

@router.get("", response_model=list[HelpPointResponse])
@router.get("/", response_model=list[HelpPointResponse])
async def list_help_points(
    lat: float | None = Query(None, ge=-90, le=90, description="User current latitude"),
    lng: float | None = Query(None, ge=-180, le=180, description="User current longitude"),
    radius_m: int = Query(5000, ge=500, le=25000, description="Search radius in metres"),
):
    """
    Return genuine nearby emergency help points (police stations, hospitals, emergency facilities).
    Strictly requires user GPS coordinates. Never returns hardcoded mock locations.
    """
    if lat is None or lng is None:
        raise HTTPException(
            status_code=400,
            detail="Latitude and longitude are required to search for genuine nearby emergency help.",
        )

    places = get_nearby_places(lat, lng, radius_m)
    return places