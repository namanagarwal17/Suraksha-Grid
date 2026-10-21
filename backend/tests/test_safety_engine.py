"""
Suraksha Grid — Safety Engine Tests
=====================================
Run:  cd backend && pytest tests/test_safety_engine.py -v

Tests cover:
- score calculation
- weight handling
- time decay
- confidence calculation
- route scoring
- anomaly detection
- edge cases: no reports, many recent, old only, conflicting,
              low confidence, high severity, night vs day
"""
from __future__ import annotations
import math
import pytest
from datetime import datetime, timezone

from app.services.safety_engine import (
    # Public API
    calculate_safety_score, score_route, check_anomaly,
    # Data classes
    SafetyInput, ReportSignal, SegmentForScoring,
    # Internals we want to test explicitly
    Weight, decay_weight, SafetyEngine,
    TIME_OF_DAY_FACTOR, EMERGENCY_SCORE,
    AnomalyDetector, RouteScorer,
    ANOMALY_REPORT_SPIKE, ANOMALY_WINDOW_HOURS,
)


# ================================================================
# Helpers
# ================================================================

def make_input(**kwargs) -> SafetyInput:
    defaults = dict(
        lighting=70.0,
        pedestrian_activity=70.0,
        emergency_access="Good",
        reports=[],
        observation_hour=14,   # afternoon baseline
    )
    defaults.update(kwargs)
    return SafetyInput(**defaults)


def make_report(severity: int = 2, age_hours: float = 1.0, category: str = "Other") -> ReportSignal:
    return ReportSignal(category=category, severity=severity, age_hours=age_hours)


# ================================================================
# Weight model
# ================================================================

class TestWeights:
    def test_weights_sum_to_one(self):
        total = (
            Weight.LIGHTING + Weight.PEDESTRIAN_ACTIVITY
            + Weight.RECENT_REPORTS + Weight.INCIDENT_SEVERITY
            + Weight.EMERGENCY_ACCESS + Weight.TIME_OF_DAY
        )
        assert abs(total - 1.0) < 1e-9, f"Weights sum to {total}"

    def test_no_single_weight_dominates(self):
        for attr in ["LIGHTING","PEDESTRIAN_ACTIVITY","RECENT_REPORTS",
                     "INCIDENT_SEVERITY","EMERGENCY_ACCESS","TIME_OF_DAY"]:
            val = getattr(Weight, attr)
            assert val <= 0.35, f"{attr}={val} exceeds 35% — no single factor should dominate"


# ================================================================
# Time decay
# ================================================================

class TestDecay:
    def test_fresh_report_weight_one(self):
        assert decay_weight(0) == 1.0

    def test_half_life(self):
        w = decay_weight(12.0, half_life_hours=12.0)
        assert abs(w - 0.5) < 0.001

    def test_double_half_life(self):
        w = decay_weight(24.0, half_life_hours=12.0)
        assert abs(w - 0.25) < 0.001

    def test_very_old_report_near_zero(self):
        w = decay_weight(240.0)   # 10 days
        assert w <= 0.02

    def test_never_reaches_zero(self):
        """Old reports never fully vanish — absence ≠ safety."""
        w = decay_weight(9999.0)
        assert w >= 0.01

    def test_negative_age_treated_as_fresh(self):
        assert decay_weight(-5) == 1.0

    def test_monotone_decrease(self):
        ages = [0, 6, 12, 24, 48, 96, 192]
        weights = [decay_weight(a) for a in ages]
        for i in range(len(weights) - 1):
            assert weights[i] >= weights[i+1], "decay must be monotonically decreasing"


# ================================================================
# Score calculation — core cases
# ================================================================

class TestScoreCalculation:
    def test_score_in_range(self):
        result = calculate_safety_score(make_input())
        assert 0 <= result.safety_score <= 100
        assert 0 <= result.confidence_score <= 100

    def test_no_reports_neutral_not_safe(self):
        """No data should not produce a near-perfect score."""
        result = calculate_safety_score(make_input(reports=[]))
        assert result.safety_score < 85, "No reports should not yield near-perfect score"

    def test_many_recent_reports_lower_score(self):
        reports = [make_report(severity=3, age_hours=0.5) for _ in range(8)]
        inp_clean = make_input(reports=[])
        inp_busy  = make_input(reports=reports)
        clean = calculate_safety_score(inp_clean)
        busy  = calculate_safety_score(inp_busy)
        assert busy.safety_score < clean.safety_score, (
            f"Many reports ({busy.safety_score}) should score lower than none ({clean.safety_score})"
        )

    def test_old_reports_less_impact_than_recent(self):
        old_reports   = [make_report(severity=4, age_hours=96) for _ in range(5)]
        fresh_reports = [make_report(severity=4, age_hours=0.5) for _ in range(5)]
        score_old   = calculate_safety_score(make_input(reports=old_reports)).safety_score
        score_fresh = calculate_safety_score(make_input(reports=fresh_reports)).safety_score
        assert score_fresh < score_old, "Fresh reports must impact score more than old ones"

    def test_high_severity_lowers_score(self):
        low_sev  = [make_report(severity=1, age_hours=1)]
        high_sev = [make_report(severity=5, age_hours=1)]
        low  = calculate_safety_score(make_input(reports=low_sev)).safety_score
        high = calculate_safety_score(make_input(reports=high_sev)).safety_score
        assert high < low, "Higher severity reports should lower the score"

    def test_poor_lighting_lowers_score(self):
        good = calculate_safety_score(make_input(lighting=90)).safety_score
        poor = calculate_safety_score(make_input(lighting=10)).safety_score
        assert poor < good

    def test_night_lower_than_afternoon(self):
        afternoon = calculate_safety_score(make_input(observation_hour=14)).safety_score
        night     = calculate_safety_score(make_input(observation_hour=2)).safety_score
        assert night < afternoon, "Night should yield lower score than afternoon"

    def test_limited_emergency_access_lowers_score(self):
        good    = calculate_safety_score(make_input(emergency_access="Good")).safety_score
        limited = calculate_safety_score(make_input(emergency_access="Limited")).safety_score
        assert limited < good

    def test_score_never_above_100(self):
        perfect = make_input(lighting=100, pedestrian_activity=100,
                             emergency_access="Good", reports=[])
        result = calculate_safety_score(perfect)
        assert result.safety_score <= 100

    def test_score_never_below_zero(self):
        worst = make_input(
            lighting=0, pedestrian_activity=0, emergency_access="Limited",
            reports=[make_report(severity=5, age_hours=0.1) for _ in range(20)],
            observation_hour=2,
        )
        result = calculate_safety_score(worst)
        assert result.safety_score >= 0

    def test_explanation_mentions_index_not_probability(self):
        result = calculate_safety_score(make_input())
        expl = result.explanation.lower()
        assert "index" in expl or "indices" in expl, \
            "Explanation must clarify score is an index, not a probability"
        assert "%" not in expl or "%" not in result.explanation.split("Score")[1][:10]


# ================================================================
# Confidence
# ================================================================

class TestConfidence:
    def test_no_reports_lower_confidence(self):
        no_data = calculate_safety_score(make_input(reports=[]))
        some_data = calculate_safety_score(make_input(
            reports=[make_report() for _ in range(6)]
        ))
        assert some_data.confidence_score >= no_data.confidence_score

    def test_recent_reports_boost_confidence(self):
        old   = calculate_safety_score(make_input(reports=[make_report(age_hours=96) for _ in range(3)]))
        fresh = calculate_safety_score(make_input(reports=[make_report(age_hours=0.5) for _ in range(3)]))
        assert fresh.confidence_score >= old.confidence_score

    def test_sensor_data_boosts_confidence(self):
        no_sensors  = calculate_safety_score(make_input(has_lighting_sensor=False, has_cctv=False))
        with_sensors= calculate_safety_score(make_input(has_lighting_sensor=True, has_cctv=True))
        assert with_sensors.confidence_score > no_sensors.confidence_score

    def test_conflicting_signals_lower_confidence(self):
        consistent  = make_input(reports=[make_report(severity=1) for _ in range(4)])
        conflicting = make_input(reports=[
            make_report(severity=1), make_report(severity=1),
            make_report(severity=5), make_report(severity=5),
        ])
        c1 = calculate_safety_score(consistent).confidence_score
        c2 = calculate_safety_score(conflicting).confidence_score
        assert c2 <= c1, "Conflicting severities should reduce confidence"

    def test_confidence_always_positive(self):
        worst = make_input(lighting=0, pedestrian_activity=0,
                           emergency_access="Limited", reports=[])
        assert calculate_safety_score(worst).confidence_score >= 10


# ================================================================
# Route scoring
# ================================================================

class TestRouteScoring:
    def _seg(self, id: str, score: int, conf: int = 80, km: float = 0.5) -> SegmentForScoring:
        return SegmentForScoring(id=id, safety_score=score, confidence=conf, length_km=km)

    def test_empty_segments_returns_defaults(self):
        result = score_route([])
        assert 0 <= result.safety_score <= 100
        assert result.risk_factors  # should flag insufficient data

    def test_all_safe_segments_high_score(self):
        segs = [self._seg(str(i), 90) for i in range(4)]
        result = score_route(segs)
        assert result.safety_score >= 75

    def test_all_unsafe_segments_low_score(self):
        segs = [self._seg(str(i), 20) for i in range(4)]
        result = score_route(segs)
        assert result.safety_score <= 40

    def test_longer_unsafe_segment_drags_score_down(self):
        """A 3 km unsafe segment should matter more than a 0.5 km unsafe segment."""
        short_risk = score_route([self._seg("a", 90, km=2.0), self._seg("b", 30, km=0.5)])
        long_risk  = score_route([self._seg("a", 90, km=2.0), self._seg("b", 30, km=2.5)])
        assert long_risk.safety_score < short_risk.safety_score

    def test_explanation_mentions_score_and_confidence(self):
        segs = [self._seg("a", 70), self._seg("b", 80)]
        result = score_route(segs)
        assert "Safety Score" in result.explanation
        assert "Confidence" in result.explanation

    def test_low_confidence_segment_reduces_route_confidence(self):
        high_conf = score_route([self._seg("a", 80, conf=95), self._seg("b", 80, conf=90)])
        low_conf  = score_route([self._seg("a", 80, conf=95), self._seg("b", 80, conf=15)])
        assert low_conf.confidence_score < high_conf.confidence_score


# ================================================================
# Anomaly detection
# ================================================================

class TestAnomalyDetection:
    def test_no_reports_no_anomaly(self):
        result = check_anomaly([])
        assert not result.is_anomaly
        assert result.severity == "none"

    def test_few_old_reports_no_anomaly(self):
        reports = [make_report(age_hours=48) for _ in range(3)]
        result = check_anomaly(reports)
        assert not result.is_anomaly

    def test_spike_within_window_is_anomaly(self):
        reports = [make_report(age_hours=0.5) for _ in range(ANOMALY_REPORT_SPIKE)]
        result = check_anomaly(reports)
        assert result.is_anomaly

    def test_spike_is_high_with_high_severity(self):
        reports = [make_report(severity=5, age_hours=0.5) for _ in range(ANOMALY_REPORT_SPIKE)]
        result = check_anomaly(reports)
        assert result.is_anomaly
        assert result.severity == "high"

    def test_high_severity_small_count_is_anomaly(self):
        reports = [make_report(severity=5, age_hours=0.3), make_report(severity=4, age_hours=0.5)]
        result = check_anomaly(reports)
        assert result.is_anomaly
        assert result.severity in ("high", "medium")

    def test_reason_not_empty(self):
        reports = [make_report(severity=5, age_hours=0.1) for _ in range(6)]
        result = check_anomaly(reports)
        assert result.reason.strip() != ""

    def test_old_spike_outside_window_no_anomaly(self):
        """Reports outside the detection window should not trigger anomaly."""
        reports = [make_report(age_hours=ANOMALY_WINDOW_HOURS + 1) for _ in range(10)]
        result = check_anomaly(reports)
        assert not result.is_anomaly


# ================================================================
# Edge cases
# ================================================================

class TestEdgeCases:
    def test_single_critical_report_matters(self):
        base  = calculate_safety_score(make_input()).safety_score
        with1 = calculate_safety_score(make_input(
            reports=[make_report(severity=5, age_hours=0.1)]
        )).safety_score
        assert with1 < base

    def test_observation_hour_boundary(self):
        """Scores at hour 0 and 23 should both be in range and lower than noon."""
        noon_score  = calculate_safety_score(make_input(observation_hour=12)).safety_score
        h0_score    = calculate_safety_score(make_input(observation_hour=0)).safety_score
        h23_score   = calculate_safety_score(make_input(observation_hour=23)).safety_score
        assert 0 <= h0_score <= 100
        assert 0 <= h23_score <= 100
        assert h0_score  <= noon_score
        assert h23_score <= noon_score

    def test_report_severity_validation(self):
        with pytest.raises((ValueError, Exception)):
            ReportSignal(category="Other", severity=6, age_hours=1)

    def test_negative_age_handled(self):
        """Negative age should not crash the engine."""
        with pytest.raises((ValueError, Exception)):
            ReportSignal(category="Other", severity=2, age_hours=-1)

    def test_extreme_input_values_clamped(self):
        result = calculate_safety_score(make_input(lighting=150, pedestrian_activity=-50))
        assert 0 <= result.safety_score <= 100