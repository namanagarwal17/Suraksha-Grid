"""
Tests for the Gemini service and report analysis pipeline.
Run: cd backend && pytest tests/test_gemini.py -v

All tests mock the Gemini HTTP call — no real API key required.
"""
from __future__ import annotations
import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.gemini_service import (
    GeminiService, GeminiAnalysis, get_gemini_service,
)


# ── helpers ──────────────────────────────────────────────────────────────────

def make_gemini_response(content: str) -> MagicMock:
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {
        "candidates": [{"content": {"parts": [{"text": content}]}}]
    }
    return mock_resp


VALID_ANALYSIS = json.dumps({
    "category": "poor_lighting",
    "severity": 3,
    "lighting": "low",
    "pedestrian_activity": "low",
    "time_context": "night",
    "summary": "Streetlight broken near the crossing.",
    "confidence": "medium",
})


# ── schema validation ─────────────────────────────────────────────────────────

class TestGeminiAnalysisSchema:
    def test_valid_analysis_parses(self):
        a = GeminiAnalysis.model_validate(json.loads(VALID_ANALYSIS))
        assert a.category == "poor_lighting"
        assert a.severity == 3
        assert a.lighting == "low"
        assert a.confidence == "medium"

    def test_severity_clamped_high(self):
        a = GeminiAnalysis.model_validate({"category": "other", "severity": 99,
            "lighting":"unknown","pedestrian_activity":"unknown",
            "time_context":"unknown","summary":"x","confidence":"low"})
        assert a.severity == 5

    def test_severity_clamped_low(self):
        a = GeminiAnalysis.model_validate({"category": "other", "severity": -3,
            "lighting":"unknown","pedestrian_activity":"unknown",
            "time_context":"unknown","summary":"x","confidence":"low"})
        assert a.severity == 1

    def test_invalid_category_raises(self):
        with pytest.raises(Exception):
            GeminiAnalysis.model_validate({
                "category": "invalid_cat", "severity": 2,
                "lighting":"unknown","pedestrian_activity":"unknown",
                "time_context":"unknown","summary":"x","confidence":"low"
            })

    def test_summary_truncation_at_schema_level(self):
        long = "x" * 600
        a = GeminiAnalysis.model_validate({
            "category": "other", "severity": 1,
            "lighting":"unknown","pedestrian_activity":"unknown",
            "time_context":"unknown","summary": long,"confidence":"low"
        })
        assert len(a.summary) <= 500


# ── no API key ────────────────────────────────────────────────────────────────

class TestNoApiKey:
    @pytest.mark.asyncio
    async def test_falls_back_gracefully(self, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        svc = GeminiService()
        result = await svc.analyse("Very dark street, no lights at all.")
        assert not result.gemini_used
        assert result.error is not None
        assert result.analysis is not None      # rule-based fallback
        assert result.original_text != ""

    @pytest.mark.asyncio
    async def test_empty_text_handled(self, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        svc = GeminiService()
        result = await svc.analyse("   ")
        assert result.error is not None


# ── Gemini available ──────────────────────────────────────────────────────────

class TestGeminiAvailable:
    @pytest.mark.asyncio
    async def test_valid_response_parsed(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        svc = GeminiService()
        mock_resp = make_gemini_response(VALID_ANALYSIS)
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)
            result = await svc.analyse("Streetlight broken near the crossing.")
        assert result.gemini_used
        assert result.analysis.category == "poor_lighting"
        assert result.analysis.severity == 3

    @pytest.mark.asyncio
    async def test_markdown_fences_stripped(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        svc = GeminiService()
        wrapped = f"```json\n{VALID_ANALYSIS}\n```"
        mock_resp = make_gemini_response(wrapped)
        with patch("httpx.AsyncClient") as mc:
            mock_client = AsyncMock()
            mc.return_value.__aenter__.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)
            result = await svc.analyse("Broken light.")
        assert result.gemini_used
        assert result.analysis.category == "poor_lighting"

    @pytest.mark.asyncio
    async def test_malformed_json_falls_back(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        svc = GeminiService()
        mock_resp = make_gemini_response("This is not JSON at all!")
        with patch("httpx.AsyncClient") as mc:
            mock_client = AsyncMock()
            mc.return_value.__aenter__.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)
            result = await svc.analyse("Some report text.")
        assert not result.gemini_used
        assert result.error is not None
        assert result.analysis is not None   # rule-based fallback kicks in

    @pytest.mark.asyncio
    async def test_network_timeout_falls_back(self, monkeypatch):
        import httpx
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        svc = GeminiService()
        with patch("httpx.AsyncClient") as mc:
            mock_client = AsyncMock()
            mc.return_value.__aenter__.return_value = mock_client
            mock_client.post = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
            result = await svc.analyse("Some report text.")
        assert not result.gemini_used
        assert "unavailable" in (result.error or "").lower() or result.error is not None


# ── Multilingual ──────────────────────────────────────────────────────────────

class TestMultilingual:
    @pytest.mark.asyncio
    async def test_original_text_preserved(self, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        svc = GeminiService()
        hindi_text = "रात को सड़क पर बहुत अंधेरा था।"
        result = await svc.analyse(hindi_text)
        assert result.original_text == hindi_text   # never replaced

    @pytest.mark.asyncio
    async def test_rule_based_handles_non_ascii(self, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        svc = GeminiService()
        result = await svc.analyse("très sombre ce soir, pas de lumière")
        assert result.analysis is not None
        assert 0 < result.analysis.severity <= 5


# ── Rule-based fallback directly ─────────────────────────────────────────────

class TestRuleBasedFallback:
    def test_lighting_keyword(self):
        a = GeminiService._rule_based("very dark, no lights working")
        assert a.category == "poor_lighting"
        assert a.lighting == "low"

    def test_police_keyword(self):
        a = GeminiService._rule_based("police patrol is here")
        assert a.category == "police_presence"

    def test_crowd_keyword(self):
        a = GeminiService._rule_based("very crowded bus stop")
        assert a.category == "crowded"

    def test_high_severity_keywords(self):
        a = GeminiService._rule_based("extremely dangerous road, unsafe to walk")
        assert a.severity >= 4

    def test_summary_never_empty(self):
        a = GeminiService._rule_based("x")
        assert a.summary.strip() != ""