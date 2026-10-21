"""
Suraksha Grid — Gemini Report Understanding Service
====================================================

Gemini's ONLY role: convert unstructured user text → structured safety signals.
The Safety Engine remains the sole scoring authority.

Supports multilingual input — Gemini normalises the language; the original
text is always preserved.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger(__name__)

# ── Prompt ──────────────────────────────────────────────────────────────────

EXTRACTION_PROMPT = """\
You are a safety-signal extractor for a navigation app called Suraksha Grid.

Your ONLY job is to read a safety observation and return a structured JSON
object. You do NOT calculate Safety Scores. You do NOT make recommendations.

The user may write in any language. Translate and normalise as needed but
ALWAYS preserve their original text in the "summary" field.

Return ONLY a valid JSON object — no markdown, no explanation, no extra text.

Schema (all fields required):
{{
  "category":            "poor_lighting" | "isolated" | "crowded" | "construction" | "safety_concern" | "police_presence" | "other",
  "severity":            1 | 2 | 3 | 4 | 5,
  "lighting":            "low" | "moderate" | "good" | "unknown",
  "pedestrian_activity": "low" | "moderate" | "high" | "unknown",
  "time_context":        "morning" | "afternoon" | "evening" | "night" | "unknown",
  "summary":             "<one sentence in English, preserving the user's meaning>",
  "confidence":          "low" | "medium" | "high"
}}

Severity guide: 1=minor notice, 2=minor concern, 3=moderate, 4=significant, 5=critical/unsafe.

User report:
{report_text}
"""

# ── Output schema ────────────────────────────────────────────────────────────

class GeminiAnalysis(BaseModel):
    category: Literal[
        "poor_lighting", "isolated", "crowded", "construction",
        "safety_concern", "police_presence", "other"
    ] = "other"
    severity: int = Field(default=2, ge=1, le=5)
    lighting: Literal["low", "moderate", "good", "unknown"] = "unknown"
    pedestrian_activity: Literal["low", "moderate", "high", "unknown"] = "unknown"
    time_context: Literal["morning", "afternoon", "evening", "night", "unknown"] = "unknown"
    summary: str = Field(default="No summary available", max_length=500)
    confidence: Literal["low", "medium", "high"] = "low"

    @field_validator("summary", mode="before")
    @classmethod
    def truncate_summary(cls, v: object) -> str:
        if isinstance(v, str) and len(v) > 500:
            return v[:500]
        return str(v) if v is not None else "No summary available"

    @field_validator("severity", mode="before")
    @classmethod
    def clamp_severity(cls, v: object) -> int:
        try:
            return max(1, min(5, int(v)))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return 2


@dataclass
class GeminiResult:
    """Full result including the original text and whether Gemini was used."""
    original_text: str
    language_detected: str
    analysis: GeminiAnalysis
    gemini_used: bool
    error: Optional[str] = None


# ── Service ──────────────────────────────────────────────────────────────────

class GeminiService:
    """
    Calls the Gemini API to extract structured signals from a report.

    If the API key is absent, times out, or returns malformed JSON, it falls
    back to a rule-based extractor so reports are never silently dropped.
    """

    GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
    TIMEOUT_S  = 8

    def __init__(self) -> None:
        self._api_key = os.environ.get("GEMINI_API_KEY", "")

    @property
    def available(self) -> bool:
        return bool(self._api_key)

    async def analyse(self, report_text: str) -> GeminiResult:
        text = report_text.strip()
        if not text:
            return GeminiResult(
                original_text="", language_detected="unknown",
                analysis=GeminiAnalysis(), gemini_used=False,
                error="Empty report text",
            )

        if not self.available:
            logger.warning("GEMINI_API_KEY not set — using rule-based fallback")
            return GeminiResult(
                original_text=text, language_detected="unknown",
                analysis=self._rule_based(text), gemini_used=False,
                error="GEMINI_API_KEY not configured",
            )

        try:
            return await self._call_gemini(text)
        except Exception as exc:
            logger.error("Gemini call failed: %s", exc)
            return GeminiResult(
                original_text=text, language_detected="unknown",
                analysis=self._rule_based(text), gemini_used=False,
                error=f"Gemini unavailable: {exc}",
            )

    async def _call_gemini(self, text: str) -> GeminiResult:
        import httpx

        prompt = EXTRACTION_PROMPT.format(report_text=text)
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.1, "maxOutputTokens": 256},
        }
        async with httpx.AsyncClient(timeout=self.TIMEOUT_S) as client:
            resp = await client.post(
                f"{self.GEMINI_URL}?key={self._api_key}",
                json=payload,
                headers={"Content-Type": "application/json"},
            )
        resp.raise_for_status()
        data = resp.json()
        raw_text: str = data["candidates"][0]["content"]["parts"][0]["text"]

        # Strip any accidental markdown fences
        clean = raw_text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()

        try:
            parsed = json.loads(clean)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Gemini returned non-JSON: {clean!r}") from exc

        analysis = GeminiAnalysis.model_validate(parsed)
        return GeminiResult(
            original_text=text, language_detected="auto",
            analysis=analysis, gemini_used=True,
        )

    @staticmethod
    def _rule_based(text: str) -> GeminiAnalysis:
        """
        Lightweight keyword fallback when Gemini is unavailable.
        Clearly inferior to Gemini but never silently drops a report.
        """
        lower = text.lower()
        category: GeminiAnalysis.__annotations__["category"] = "other"
        if any(w in lower for w in ["light", "dark", "lamp", "bright"]): category = "poor_lighting"
        elif any(w in lower for w in ["alone", "empty", "isolated", "deserted"]): category = "isolated"
        elif any(w in lower for w in ["crowd", "busy", "people", "rush"]): category = "crowded"
        elif any(w in lower for w in ["construct", "work", "dig", "block"]): category = "construction"
        elif any(w in lower for w in ["police", "patrol", "officer"]): category = "police_presence"

        lighting: GeminiAnalysis.__annotations__["lighting"] = "unknown"
        if any(w in lower for w in ["dark", "dim", "no light", "unlit"]): lighting = "low"
        elif any(w in lower for w in ["bright", "well lit", "light"]): lighting = "good"

        severity = 2
        if any(w in lower for w in ["very", "extremely", "dangerous", "unsafe", "critical"]): severity = 4
        elif any(w in lower for w in ["minor", "slight", "small"]): severity = 1

        # Truncate to 200 chars for the summary
        summary = text[:200] + ("…" if len(text) > 200 else "")
        return GeminiAnalysis(
            category=category, severity=severity, lighting=lighting,
            pedestrian_activity="unknown", time_context="unknown",
            summary=summary, confidence="low",
        )


# Module-level singleton
_service: Optional[GeminiService] = None

def get_gemini_service() -> GeminiService:
    global _service
    if _service is None:
        _service = GeminiService()
    return _service