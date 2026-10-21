"""
Historical Evidence model.

Aggregates CrimeIntersection objects into a single HistoricalEvidence
that can be fed to the Safety Engine as a supporting signal.

Model:
    historical_evidence =
        crime_density × WEIGHTS.density
      + severity_weight × WEIGHTS.severity
      + route_exposure  × WEIGHTS.exposure
      + time_weight     × WEIGHTS.time_weight

All terms are normalised to [0, 1].
The output score_adjustment is ≤ 0 (it can only reduce the safety score).

IMPORTANT:
- This model uses official historical data as EVIDENCE, not ground truth.
- It is NOT an NCRB risk score.
- The Safety Engine remains the sole scoring authority.
"""
from __future__ import annotations

import math
import logging
from datetime import datetime, timezone

from app.services.crime.config import (
    EVIDENCE_WEIGHTS,
    HISTORICAL_HALF_LIFE_YEARS,
    MIN_TIME_WEIGHT,
    EXPOSURE_HIGH_THRESHOLD,
    EXPOSURE_MOD_THRESHOLD,
    SOURCE_DISCLAIMER,
    UNAVAILABLE_MESSAGE,
)
from app.services.crime.models import (
    CrimeIntersection,
    EvidenceLevel,
    HistoricalEvidence,
)

logger = logging.getLogger(__name__)

# Maximum score adjustment the historical evidence can apply (negative)
MAX_ADJUSTMENT: float = -12.0


def _time_weight(year: int, reference_year: int | None = None) -> float:
    """
    Exponential decay: weight = 0.5^(age / half_life).
    Clamped to [MIN_TIME_WEIGHT, 1.0].
    """
    ref = reference_year or datetime.now(timezone.utc).year
    age = max(0, ref - year)
    w = 0.5 ** (age / HISTORICAL_HALF_LIFE_YEARS)
    return max(MIN_TIME_WEIGHT, min(1.0, w))


def _evidence_level(exposure: float) -> EvidenceLevel:
    if exposure >= EXPOSURE_HIGH_THRESHOLD: return "HIGH"
    if exposure >= EXPOSURE_MOD_THRESHOLD:  return "MODERATE"
    if exposure > 0:                        return "LOW"
    return "NONE"


def aggregate(
    intersections: list[CrimeIntersection],
    dataset_available: bool,
    reference_year: int | None = None,
) -> HistoricalEvidence:
    """
    Build a HistoricalEvidence from a list of CrimeIntersections.
    Returns a clearly-labelled UNAVAILABLE result when the dataset is absent.
    """
    if not dataset_available:
        return HistoricalEvidence(
            evidence_level    = "UNAVAILABLE",
            confidence        = 0,
            score_adjustment  = 0.0,
            intersections     = [],
            years             = [],
            categories        = [],
            source            = "",
            source_dataset    = "",
            disclaimer        = SOURCE_DISCLAIMER,
            explanation       = UNAVAILABLE_MESSAGE,
            dataset_available = False,
        )

    if not intersections:
        return HistoricalEvidence(
            evidence_level    = "NONE",
            confidence        = 40,
            score_adjustment  = 0.0,
            intersections     = [],
            years             = [],
            categories        = [],
            source            = "",
            source_dataset    = intersections[0].source_dataset if intersections else "",
            disclaimer        = SOURCE_DISCLAIMER,
            explanation       = "No historical crime areas intersect this route.",
            dataset_available = True,
        )

    # ── Per-intersection contribution ────────────────────────────────────────
    total_weighted = 0.0
    total_weight   = 0.0

    for ix in intersections:
        tw  = _time_weight(ix.year, reference_year)
        exp = ix.exposure_fraction

        # Density proxy: normalise incident_count (logarithmic scale, capped at 1)
        density = min(1.0, math.log1p(ix.incident_count) / math.log1p(5000))

        contribution = (
            density        * EVIDENCE_WEIGHTS.density
            + ix.severity_weight * EVIDENCE_WEIGHTS.severity
            + exp          * EVIDENCE_WEIGHTS.exposure
            + tw           * EVIDENCE_WEIGHTS.time_weight
        )
        w = exp  # weight each area by how much of the route it covers
        total_weighted += contribution * w
        total_weight   += w

    avg_contribution = (total_weighted / total_weight) if total_weight > 0 else 0.0
    total_exposure   = sum(ix.exposure_fraction for ix in intersections)
    level            = _evidence_level(total_exposure)

    # Adjustment: proportional to avg contribution, capped
    adjustment = round(MAX_ADJUSTMENT * avg_contribution, 1)

    # Confidence: more intersections + fresher data = higher confidence
    recent = sum(1 for ix in intersections if datetime.now(timezone.utc).year - ix.year <= 3)
    confidence = min(90, 40 + recent * 10 + (10 if len(intersections) >= 3 else 0))

    years      = sorted({ix.year for ix in intersections}, reverse=True)
    categories = sorted({ix.crime_category for ix in intersections})
    source     = intersections[0].source if intersections else ""
    dataset    = intersections[0].source_dataset if intersections else ""

    if years:
        year_range = f"{years[0]}" if min(years) == max(years) else f"{min(years)}-{max(years)}"
    else:
        year_range = "unknown"
    explanation = (
        f"{level.title()} historical crime evidence along this route "
        f"({len(intersections)} area(s), {year_range}). "
        f"Dominant categories: {', '.join(categories[:3])}. "
        + SOURCE_DISCLAIMER
    )

    return HistoricalEvidence(
        evidence_level    = level,
        confidence        = confidence,
        score_adjustment  = adjustment,
        intersections     = intersections,
        years             = years,
        categories        = categories,
        source            = source,
        source_dataset    = dataset,
        disclaimer        = SOURCE_DISCLAIMER,
        explanation       = explanation,
        dataset_available = True,
    )