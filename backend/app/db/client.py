"""
Supabase / Postgres database client for the FastAPI backend.

Uses the service-role key so it can bypass RLS when needed
(e.g. when writing computed safety scores from the backend pipeline).
Never expose the service-role key to client-facing endpoints.
"""
from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING

from app.config import get_settings

if TYPE_CHECKING:
    from supabase import Client


@lru_cache
def get_supabase() -> "Client":
    from supabase import create_client

    s = get_settings()
    if not s.supabase_url or not s.supabase_service_role_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. "
            "See backend/.env (copy from .env.example)."
        )
    return create_client(s.supabase_url, s.supabase_service_role_key)
