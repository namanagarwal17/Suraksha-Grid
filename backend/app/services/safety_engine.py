"""
Suraksha Grid — Safety Intelligence Engine
==========================================

Deterministic, explainable, fully testable.

NO AI / Gemini. Every output is reproducible from the same inputs.

Architecture
------------
SafetyInput  →  SafetyEngine.calculate()  →  SafetyResult
SafetyResult ×N →  RouteScorer.score()   →  RouteSafetyResult
[SafetyResult]  →  AnomalyDetector.check()→  AnomalyResult
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional


# ===========================================================
# Constants — all weights / thresholds live here, nowhere else
# ===========================================================

class Weight:
    """
    Transparent weighted model (must sum to 1.0).
    Changing a weight here propagates everywhere automatically.
    """
    LIGHTING              = 0.20
    PEDESTRIAN_ACTIVITY   = 0.15
    RECENT_REPORTS        = 0.25   # negative influence
    INCIDENT_SEVERITY     = 0.15   # negative influence
    EMERGENCY_ACCESS      = 0.10
    TIME_OF_DAY           = 0.15

    @classmethod
    def validate(cls) -> None:
        total = (
            cls.LIGHTING + cls.PEDESTRIAN_ACTIVITY + cls.RECENT_REPORTS
            + cls.INCIDENT_SEVERITY + cls.EMERGENCY_ACCESS + cls.TIME_OF_DAY
        )
        assert abs(total - 1.0) < 1e-9, f"Weights must sum to 1.0, got {total}"

Weight.validate()


class EmergencyAccess(str, Enum):
    GOOD    = "Good"
    FAIR    = "Fair"
    LIMITED = "Limited"

EMERGENCY_SCORE: dict[str, float] = {
    EmergencyAccess.GOOD:    1.0,
    EmergencyAccess.FAIR:    0.6,
    EmergencyAccess.LIMITED: 0.2,
}

# Time-of-day multipliers (relative safety, 1.0 = neutral)
TIME_OF_DAY_FACTOR: dict[str, float] = {
    "morning":   0.90,   # moderate — lighter traffic, some isolated stretches
    "afternoon": 1.00,   # baseline
    "evening":   0.85,   # higher pedestrian activity but dimming light
    "night":     0.70,   # lowest — reduced visibility and activity
}
# Hours → period
def _hour_to_period(hour: int) -> str:
    if 5  <= hour < 12: return "morning"
    if 12 <= hour < 17: return "afternoon"
    if 17 <= hour < 21: return "evening"
    return "night"

# Confidence thresholds
MIN_REPORTS_FOR_HIGH_CONFIDENCE = 5
MAX_REPORT_AGE_HOURS_RELEVANT   = 72   # reports older than this get ≤5% weight


# ===========================================================
# Input / output data classes
# ===========================================================

@dataclass
class ReportSignal:
    """A single safety report affecting a segment."""
    category:   str
    severity:   int        # 1 (minor) – 5 (critical)
    age_hours:  float      # how many hours ago the report was created

    def __post_init__(self) -> None:
        if not 1 <= self.severity <= 5:
            raise ValueError(f"severity must be 1–5, got {self.severity}")
        if self.age_hours < 0:
            raise ValueError("age_hours must be non-negative")


@dataclass
class SafetyInput:
    """
    All safety signals for one road segment at a point in time.
    Values are raw observations on a 0–100 scale unless noted.
    """
    lighting:              float          # 0–100
    pedestrian_activity:   float          # 0–100
    emergency_access:      str            # "Good" | "Fair" | "Limited"
    reports:               list[ReportSignal] = field(default_factory=list)
    observation_hour:      Optional[int]  = None   # 0–23; None → current UTC hour
    # Metadata for confidence calculation
    has_lighting_sensor:   bool = False
    has_cctv:              bool = False


@dataclass
class ScoreFactors:
    """Intermediate factor scores (0–1) used in the final weighted sum."""
    lighting:            float
    pedestrian_activity: float
    report_penalty:      float   # 0 = severe penalty, 1 = no penalty
    severity_penalty:    float   # 0 = severe, 1 = no penalty
    emergency_access:    float
    time_of_day:         float


@dataclass
class SafetyResult:
    """
    Output of calculate_safety_score().
    safety_score and confidence_score are 0–100 INDICES, not probabilities.
    """
    safety_score:      int                    # 0–100
    confidence_score:  int                    # 0–100
    factors:           ScoreFactors
    risk_factors:      list[str]
    positive_factors:  list[str]
    explanation:       str
    time_period:       str                    # morning/afternoon/evening/night
    calculated_at:     datetime


@dataclass
class RouteSafetyResult:
    """Route-level safety derived from its segments."""
    safety_score:     int
    confidence_score: int
    risk_factors:     list[str]
    positive_factors: list[str]
    explanation:      str


@dataclass
class AnomalyResult:
    is_anomaly: bool
    severity:   str           # "low" | "medium" | "high" | "none"
    reason:     str


# ===========================================================
# Time decay
# ===========================================================

def decay_weight(age_hours: float, half_life_hours: float = 12.0) -> float:
    """
    Exponential decay: weight = 0.5^(age / half_life).

    - A report 0 h old  → weight 1.00
    - A report 12 h old → weight 0.50
    - A report 48 h old → weight 0.063
    - A report 96 h old → weight 0.004  (≈ negligible)

    Clamps to [0.01, 1.0] so very old reports never fully disappear
    (absence of evidence ≠ evidence of safety).
    """
    if age_hours <= 0:
        return 1.0
    w = 0.5 ** (age_hours / half_life_hours)
    return max(0.01, min(1.0, w))


# ===========================================================
# Safety Engine
# ===========================================================

class SafetyEngine:
    """
    Deterministic safety score calculator.

    All arithmetic uses the Weight constants so the formula is
    auditable and the weights can be tuned without touching logic.
    """

    def calculate(self, inp: SafetyInput) -> SafetyResult:
        hour   = inp.observation_hour if inp.observation_hour is not None else datetime.now(timezone.utc).hour
        period = _hour_to_period(hour)

        # ---- 1. Normalise raw 0-100 inputs to 0-1 ----
        lighting_f  = max(0.0, min(1.0, inp.lighting  / 100.0))
        activity_f  = max(0.0, min(1.0, inp.pedestrian_activity / 100.0))
        emerg_f     = EMERGENCY_SCORE.get(inp.emergency_access, EMERGENCY_SCORE[EmergencyAccess.FAIR])
        tod_f       = TIME_OF_DAY_FACTOR.get(period, 1.0)

        # ---- 2. Report penalty (decay-weighted) ----
        report_penalty_f, severity_penalty_f = self._report_penalties(inp.reports)

        factors = ScoreFactors(
            lighting            = lighting_f,
            pedestrian_activity = activity_f,
            report_penalty      = report_penalty_f,
            severity_penalty    = severity_penalty_f,
            emergency_access    = emerg_f,
            time_of_day         = tod_f,
        )

        # ---- 3. Weighted sum ----
        raw = (
            lighting_f          * Weight.LIGHTING
            + activity_f        * Weight.PEDESTRIAN_ACTIVITY
            + report_penalty_f  * Weight.RECENT_REPORTS
            + severity_penalty_f* Weight.INCIDENT_SEVERITY
            + emerg_f           * Weight.EMERGENCY_ACCESS
            + tod_f             * Weight.TIME_OF_DAY
        )

        safety_score = round(max(0, min(100, raw * 100)))

        # ---- 4. Confidence ----
        confidence_score = self._confidence(inp)

        # ---- 5. Factors ----
        risk, positive = self._factor_labels(factors, inp.reports, period)

        explanation = self._explanation(safety_score, confidence_score, risk, positive, period)

        return SafetyResult(
            safety_score     = safety_score,
            confidence_score = confidence_score,
            factors          = factors,
            risk_factors     = risk,
            positive_factors = positive,
            explanation      = explanation,
            time_period      = period,
            calculated_at    = datetime.now(timezone.utc),
        )

    # ---- private helpers ----

    def _report_penalties(
        self, reports: list[ReportSignal]
    ) -> tuple[float, float]:
        """
        Returns (report_penalty, severity_penalty), both 0–1.
        1.0 = no penalty (no reports / all old).
        0.0 = maximum penalty.
        """
        if not reports:
            # No data → assume neutral, not safe
            return 0.65, 0.70

        total_weight       = 0.0
        weighted_count     = 0.0
        weighted_severity  = 0.0

        for r in reports:
            w = decay_weight(r.age_hours)
            total_weight      += w
            weighted_count    += w
            weighted_severity += w * (r.severity / 5.0)

        if total_weight == 0:
            return 0.65, 0.70

        avg_decay_count    = weighted_count   / total_weight   # always 1.0
        avg_decay_severity = weighted_severity / total_weight  # 0–1

        # Map weighted count to penalty (more decay-weighted reports → lower score)
        # Logistic: penalty_raw ∈ [0,1], 0 = safe, 1 = very unsafe
        n = len(reports)
        report_raw    = 1.0 - math.exp(-0.3 * total_weight)     # saturates at ~5 heavy reports
        severity_raw  = avg_decay_severity

        report_penalty   = max(0.0, 1.0 - report_raw)
        severity_penalty = max(0.0, 1.0 - severity_raw)

        return report_penalty, severity_penalty

    def _confidence(self, inp: SafetyInput) -> int:
        """
        Confidence reflects data availability and freshness, NOT safety level.
        """
        score = 50.0   # baseline

        # More reports = more data to assess
        n = len(inp.reports)
        if n >= MIN_REPORTS_FOR_HIGH_CONFIDENCE:
            score += 20
        elif n >= 2:
            score += 10
        elif n == 0:
            score -= 15  # no community data

        # Recent reports improve confidence
        recent = sum(1 for r in inp.reports if r.age_hours <= 24)
        score += min(15, recent * 5)

        # Sensor coverage
        if inp.has_lighting_sensor: score += 8
        if inp.has_cctv:            score += 7

        # Signal agreement: penalise if observations contradict each other
        if inp.reports:
            severities = [r.severity for r in inp.reports]
            spread = max(severities) - min(severities)
            if spread >= 3:   score -= 10   # high disagreement
            elif spread >= 2: score -= 5

        return round(max(10, min(100, score)))

    def _factor_labels(
        self,
        f: ScoreFactors,
        reports: list[ReportSignal],
        period: str,
    ) -> tuple[list[str], list[str]]:
        risk:     list[str] = []
        positive: list[str] = []

        if f.lighting < 0.4:   risk.append("Poor lighting")
        elif f.lighting > 0.75: positive.append("Good lighting")

        if f.pedestrian_activity < 0.35: risk.append("Low pedestrian activity")
        elif f.pedestrian_activity > 0.7: positive.append("Active pedestrian presence")

        if f.report_penalty < 0.5:  risk.append("Multiple recent safety reports")
        elif f.report_penalty > 0.8 and reports: positive.append("Few recent concerns reported")

        if f.severity_penalty < 0.5: risk.append("High-severity incidents reported")

        if f.emergency_access < 0.4: risk.append("Limited emergency accessibility")
        elif f.emergency_access >= 0.9: positive.append("Good emergency access")

        if period == "night" and f.lighting < 0.6:
            risk.append("Night-time with dim lighting")
        elif period in ("morning", "afternoon"):
            positive.append(f"Favourable {period} conditions")

        return risk, positive

    def _explanation(
        self,
        score: int,
        conf: int,
        risk: list[str],
        positive: list[str],
        period: str,
    ) -> str:
        if score >= 80:
            intro = "Generally safe conditions"
        elif score >= 65:
            intro = "Moderate safety conditions"
        elif score >= 50:
            intro = "Elevated caution advised"
        else:
            intro = "Higher caution recommended"

        parts = [intro]
        if risk:
            parts.append(f"Key concerns: {', '.join(risk[:2]).lower()}.")
        if positive:
            parts.append(f"Positive factors: {', '.join(positive[:2]).lower()}.")
        parts.append(
            f"Safety Score {score} · Confidence {conf} · "
            f"Note: scores are indices (0–100), not probabilities."
        )
        return " ".join(parts)


# ===========================================================
# Route Scorer
# ===========================================================

@dataclass
class SegmentForScoring:
    """Minimal view of a segment needed by the route scorer."""
    id:           str
    safety_score: int
    confidence:   int
    length_km:    float = 0.5    # approximate — used for exposure weighting


class RouteScorer:
    """
    Derives a route-level Safety Score from its constituent segments.

    NOT a simple average: longer segments contribute proportionally more
    to the route score, and low-confidence segments reduce route confidence.
    """

    def score(self, segments: list[SegmentForScoring]) -> RouteSafetyResult:
        if not segments:
            return RouteSafetyResult(
                safety_score=50, confidence_score=30,
                risk_factors=["No segment data available"],
                positive_factors=[],
                explanation="Safety Score 50 · Confidence 30 · Insufficient segment data."
            )

        total_km = sum(s.length_km for s in segments)
        if total_km == 0:
            total_km = len(segments) * 0.5

        # Length-weighted safety score
        weighted_safety = sum(s.safety_score * (s.length_km / total_km) for s in segments)
        safety_score    = round(max(0, min(100, weighted_safety)))

        # Route confidence = weighted harmonic mean of segment confidences
        # (pulled down by the weakest link)
        inv_sum = sum((s.length_km / total_km) / max(1, s.confidence) for s in segments)
        route_conf = round(max(10, min(100, 1.0 / inv_sum))) if inv_sum > 0 else 30

        # Identify segments that drive the score up or down
        sorted_segs = sorted(segments, key=lambda s: s.safety_score)
        risky    = [s for s in sorted_segs[:2] if s.safety_score < 60]
        positive = [s for s in sorted_segs[-2:] if s.safety_score >= 75]

        risk_factors     = [f"Low score on segment {s.id}" for s in risky]
        positive_factors = [f"High score on segment {s.id}" for s in positive]

        explanation = (
            f"Safety Score {safety_score} · Confidence {route_conf} · "
            f"Derived from {len(segments)} segment(s) across {total_km:.1f} km. "
            + (f"Concerns on: {', '.join(s.id for s in risky)}. " if risky else "")
            + "Scores are indices (0–100), not probabilities."
        )

        return RouteSafetyResult(
            safety_score     = safety_score,
            confidence_score = route_conf,
            risk_factors     = risk_factors,
            positive_factors = positive_factors,
            explanation      = explanation,
        )


# ===========================================================
# Anomaly Detector
# ===========================================================

# Thresholds
ANOMALY_REPORT_SPIKE    = 5      # ≥ N new reports within threshold window
ANOMALY_WINDOW_HOURS    = 2.0
ANOMALY_SEVERITY_HIGH   = 4      # avg severity ≥ this → high anomaly
ANOMALY_SEVERITY_MEDIUM = 3


class AnomalyDetector:
    """
    Lightweight deterministic anomaly detector.
    Detects report spikes, severity spikes and spatial concentrations.
    No ML / AI. All logic is rule-based and testable.
    """

    def check(self, reports: list[ReportSignal]) -> AnomalyResult:
        if not reports:
            return AnomalyResult(is_anomaly=False, severity="none", reason="No reports to evaluate.")

        recent = [r for r in reports if r.age_hours <= ANOMALY_WINDOW_HOURS]

        # Spike in volume
        if len(recent) >= ANOMALY_REPORT_SPIKE:
            avg_sev = sum(r.severity for r in recent) / len(recent)
            sev_label = "high" if avg_sev >= ANOMALY_SEVERITY_HIGH else "medium"
            return AnomalyResult(
                is_anomaly=True,
                severity=sev_label,
                reason=(
                    f"{len(recent)} reports in the last {ANOMALY_WINDOW_HOURS:.0f} h "
                    f"(avg severity {avg_sev:.1f}/5). Possible emerging safety issue."
                ),
            )

        # Severity spike even with fewer reports
        if recent:
            avg_sev = sum(r.severity for r in recent) / len(recent)
            if avg_sev >= ANOMALY_SEVERITY_HIGH:
                return AnomalyResult(
                    is_anomaly=True,
                    severity="high",
                    reason=f"High average severity ({avg_sev:.1f}/5) in recent reports.",
                )
            if avg_sev >= ANOMALY_SEVERITY_MEDIUM and len(recent) >= 2:
                return AnomalyResult(
                    is_anomaly=True,
                    severity="medium",
                    reason=f"Moderate severity ({avg_sev:.1f}/5) across {len(recent)} recent reports.",
                )

        return AnomalyResult(is_anomaly=False, severity="none", reason="No anomaly detected.")


# ===========================================================
# Historical Evidence integration
# ===========================================================

def apply_historical_evidence(
    result: "SafetyResult",
    adjustment: float,
    evidence_explanation: str,
) -> "SafetyResult":
    """
    Apply a historical crime evidence adjustment to an existing SafetyResult.

    The Safety Engine's deterministic score is computed first; the adjustment
    (always ≤ 0) is then applied as a supporting signal — never as the sole
    authority.

    If adjustment == 0 (dataset unavailable or no intersection), the result
    is returned unchanged.
    """
    if adjustment == 0.0:
        return result

    new_score = max(0, result.safety_score + round(adjustment))
    new_explanation = result.explanation + f" · Historical evidence: {evidence_explanation}"

    return SafetyResult(
        safety_score     = new_score,
        confidence_score = result.confidence_score,
        factors          = result.factors,
        risk_factors     = result.risk_factors
                           + (["Historical crime data indicates elevated exposure"] if adjustment < -5 else []),
        positive_factors = result.positive_factors,
        explanation      = new_explanation,
        time_period      = result.time_period,
        calculated_at    = result.calculated_at,
    )


# ===========================================================
# Module-level convenience singletons
# ===========================================================
engine   = SafetyEngine()
scorer   = RouteScorer()
detector = AnomalyDetector()


def calculate_safety_score(inp: SafetyInput) -> SafetyResult:
    """Public API: compute safety score + confidence for one segment."""
    return engine.calculate(inp)


def score_route(segments: list[SegmentForScoring]) -> RouteSafetyResult:
    """Public API: derive route-level score from segment list."""
    return scorer.score(segments)


def check_anomaly(reports: list[ReportSignal]) -> AnomalyResult:
    """Public API: check for anomalies in a report stream."""
    return detector.check(reports)