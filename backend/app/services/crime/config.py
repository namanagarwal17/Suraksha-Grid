"""
Historical Crime Evidence — configuration constants.

All weights and thresholds live here so they can be tuned without
touching the engine logic.
"""
from __future__ import annotations
from dataclasses import dataclass, field


# ── Evidence weights (must remain in (0, 1]) ─────────────────────────────────

@dataclass(frozen=True)
class EvidenceWeights:
    """
    Weights applied inside the historical evidence aggregation model.

    historical_evidence =
        crime_density × SEVERITY × route_exposure × TIME_WEIGHT

    All factors are normalised to [0, 1] before weighting.
    """
    # How much raw crime density (incidents / area) influences the output
    density: float       = 0.35
    # How much the severity_weight assigned to a crime category matters
    severity: float      = 0.30
    # How much of the route is exposed to this area
    exposure: float      = 0.25
    # Temporal relevance (decayed based on data age)
    time_weight: float   = 0.10

    def __post_init__(self) -> None:
        total = self.density + self.severity + self.exposure + self.time_weight
        if abs(total - 1.0) > 1e-9:
            raise ValueError(f"EvidenceWeights must sum to 1.0, got {total}")


EVIDENCE_WEIGHTS = EvidenceWeights()


# ── Time decay ────────────────────────────────────────────────────────────────

# Half-life for historical data in years (data from N years ago has 50% weight
# at HISTORICAL_HALF_LIFE_YEARS, 25% at 2×, etc.)
HISTORICAL_HALF_LIFE_YEARS: float = 3.0

# Minimum temporal weight (very old data still counts a little)
MIN_TIME_WEIGHT: float = 0.05


# ── Severity categories ───────────────────────────────────────────────────────

# Default severity weight for a crime category if not explicitly mapped.
# Values must be in [0, 1]: 1 = highest severity.
DEFAULT_SEVERITY_WEIGHT: float = 0.3

# Broad severity mapping — adjust once the exact NCRB category names are known.
# Keys are lowercase normalised strings.
CATEGORY_SEVERITY: dict[str, float] = {
    # Violent / bodily harm
    "murder":                         1.0,
    "attempt to murder":              0.9,
    "rape":                           1.0,
    "kidnapping":                     0.9,
    "robbery":                        0.8,
    "dacoity":                        0.9,
    "assault":                        0.7,
    "grievous hurt":                  0.7,
    # Property / street crime
    "theft":                          0.4,
    "chain snatching":                0.6,
    "snatching":                      0.6,
    "pick pocketing":                 0.4,
    "burglary":                       0.5,
    "house breaking":                 0.5,
    # Cyber / fraud
    "cyber crime":                    0.3,
    "cheating":                       0.2,
    "fraud":                          0.2,
    # Traffic / public order
    "hit and run":                    0.5,
    "road accident":                  0.5,
    "rioting":                        0.7,
    # Catch-all
    "other ipc crimes":               0.3,
    "other sll crimes":               0.2,
}


# ── Spatial / route analysis ──────────────────────────────────────────────────

# Minimum intersection length (metres) for a crime area to be considered
# relevant to a route; avoids artefacts from near-miss topology
MIN_INTERSECTION_METRES: float = 50.0

# Above this exposure fraction the evidence level is "HIGH"
EXPOSURE_HIGH_THRESHOLD: float  = 0.30
# Above this it is "MODERATE"
EXPOSURE_MOD_THRESHOLD: float   = 0.10


# ── API / evidence output ─────────────────────────────────────────────────────

EVIDENCE_LEVELS = ("NONE", "LOW", "MODERATE", "HIGH", "UNAVAILABLE")

SOURCE_DISCLAIMER = (
    "Historical crime evidence is area-level data. "
    "It does not indicate that a specific crime occurred on this road. "
    "Safety Score is an evidence-based index, not a probability of crime."
)

UNAVAILABLE_MESSAGE = (
    "Historical crime evidence unavailable. "
    "Import the NCRB dataset to enable this feature."
)