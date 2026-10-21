"""
Application configuration — all values read from environment variables.
Copy .env.example to backend/.env and fill in your values.
"""
from __future__ import annotations
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Supabase / Postgres
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    database_url: str = ""

    # CORS — comma-separated list, e.g. "http://localhost:3000"
    allowed_origins: str = "http://localhost:3000"

    # OpenRouteService
    openrouteservice_api_key: str = ""
    ors_base_url: str = "https://api.openrouteservice.org/v2/directions"

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
