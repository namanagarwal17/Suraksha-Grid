"""
Canonical internal data models for the historical crime evidence subsystem.

These are independent of the source dataset format (NCRB CSV, GeoJSON, etc.).
The normaliser maps raw source records into these types.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal, Optional


# ── Canonical crime record ────────────────────────────────────────────────────

@dataclass
class CrimeRecord:
    """
    One normalised crime observation.
    All fields use canonical names regardless of the source dataset.
    """
    state:           str
    district:        str
    crime_category:  str       # normalised lowercase
    incident_count:  int
    year:            int
    source:          str       # e.g. "NCRB"
    source_dataset:  str       # e.g. "Crime in India 2023"

    # Optional — supplied if source data or a geometry join provides it
    latitude:        Optional[float] = None
    longitude:       Optional[float] = None

    # Enriched by config.py lookup after normalisation
    severity_weight: float = 0.3

    # Any extra columns preserved verbatim
    metadata:        dict[str, Any] = field(default_factory=dict)


# ── Import summary ────────────────────────────────────────────────────────────

@dataclass
class ImportSummary:
    source_file:     str
    total_rows:      int
    imported:        int
    skipped:         int
    skip_reasons:    dict[str, int] = field(default_factory=dict)
    started_at:      datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    finished_at:     Optional[datetime] = None

    def finish(self) -> None:
        self.finished_at = datetime.now(timezone.utc)

    def __str__(self) -> str:
        elapsed = ""
        if self.finished_at:
            elapsed = f" ({(self.finished_at - self.started_at).total_seconds():.1f}s)"
        return (
            f"Import summary{elapsed}: "
            f"{self.imported}/{self.total_rows} rows imported, "
            f"{self.skipped} skipped"
            + (f" — reasons: {self.skip_reasons}" if self.skip_reasons else "")
        )


# ── Spatial / route analysis ──────────────────────────────────────────────────

@dataclass
class CrimeIntersection:
    """One crime area that intersects with a route."""
    district:            str
    state:               str
    crime_category:      str
    incident_count:      int
    year:                int
    severity_weight:     float
    intersection_m:      float    # metres of route inside this area
    route_length_m:      float    # total route length
    source:              str
    source_dataset:      str

    @property
    def exposure_fraction(self) -> float:
        if self.route_length_m <= 0:
            return 0.0
        return min(1.0, self.intersection_m / self.route_length_m)


# ── Aggregated evidence ───────────────────────────────────────────────────────

EvidenceLevel = Literal["NONE", "LOW", "MODERATE", "HIGH", "UNAVAILABLE"]

@dataclass
class HistoricalEvidence:
    """
    Aggregated historical crime evidence for a segment or route.
    Fed into the Safety Engine as a supporting signal — never as the sole score.
    """
    evidence_level:   EvidenceLevel
    confidence:       int                      # 0–100
    score_adjustment: float                    # negative float; added to raw safety score
    intersections:    list[CrimeIntersection]  # contributing areas
    years:            list[int]                # years present in the evidence
    categories:       list[str]                # crime categories present
    source:           str
    source_dataset:   str
    disclaimer:       str
    explanation:      str
    dataset_available: bool                    # False when table is empty