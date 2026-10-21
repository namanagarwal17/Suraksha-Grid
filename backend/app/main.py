"""
Suraksha Grid — FastAPI application entry point.
"""
from __future__ import annotations
from dotenv import load_dotenv

load_dotenv()
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.api.v1 import router as api_v1_router

settings = get_settings()

app = FastAPI(
    title="Suraksha Grid API",
    description="Backend for the Suraksha Grid safety-aware navigation app.",
    version="0.3.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS — allow the Next.js dev server and any configured origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_v1_router, prefix="/api/v1")


@app.get("/health", tags=["meta"])
async def health() -> dict:
    """Liveness probe — returns 200 when the process is running."""
    return {"status": "ok", "service": "suraksha-grid-api"}
