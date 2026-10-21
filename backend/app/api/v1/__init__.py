from fastapi import APIRouter
from app.api.v1 import segments, routes, reports, stories, help_points, safety, emergency, crime

router = APIRouter()
router.include_router(segments.router,    prefix="/segments",    tags=["segments"])
router.include_router(routes.router,      prefix="/routes",      tags=["routes"])
router.include_router(reports.router,     prefix="/reports",     tags=["reports"])
router.include_router(stories.router,     prefix="/stories",     tags=["stories"])
router.include_router(help_points.router, prefix="/help",        tags=["help"])
router.include_router(safety.router,      prefix="/safety",      tags=["safety"])
router.include_router(emergency.router,   prefix="/emergency",   tags=["emergency"])
router.include_router(crime.router,       prefix="/crime",       tags=["crime"])