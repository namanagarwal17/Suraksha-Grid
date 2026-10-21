"""
Dataset-agnostic normaliser.

Maps arbitrary source column names into the canonical CrimeRecord schema.
The COLUMN_ALIASES dict is the single place to add new source column names
when a new dataset arrives — no other code changes needed.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from app.services.crime.models import CrimeRecord
from app.services.crime.config import CATEGORY_SEVERITY, DEFAULT_SEVERITY_WEIGHT

logger = logging.getLogger(__name__)

# ── Column aliases ────────────────────────────────────────────────────────────
# Maps canonical field → list of possible source column names (case-insensitive).
# Add new aliases here when integrating a new dataset format.

COLUMN_ALIASES: dict[str, list[str]] = {
    "state": [
        "state", "state_name", "states", "state/ut", "state/uts",
        "state_ut", "statename",
    ],
    "district": [
        "district", "district_name", "districts", "dist",
        "district_code", "districtname",
    ],
    "crime_category": [
        "crime_category", "crime_head", "crime_type", "offence",
        "offense", "crime", "head", "crime_head_group",
        "ipc_category", "sll_category", "category",
    ],
    "incident_count": [
        "incident_count", "cases_reported", "cases", "count",
        "total_cases", "no_of_cases", "number_of_cases", "incidents",
        "value", "total",
    ],
    "year": [
        "year", "yr", "data_year", "report_year", "year_of_crime",
    ],
    "latitude": [
        "latitude", "lat", "y",
    ],
    "longitude": [
        "longitude", "long", "lon", "lng", "x",
    ],
}


def _build_reverse_map(raw_columns: list[str]) -> dict[str, str]:
    """
    Returns {canonical_field: matched_raw_column} for every column we can map.
    Unrecognised columns are captured as metadata.
    """
    raw_lower = {c.strip().lower().replace(" ", "_"): c for c in raw_columns}
    result: dict[str, str] = {}
    for canonical, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in raw_lower:
                result[canonical] = raw_lower[alias]
                break
    return result


def _normalise_str(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _normalise_category(raw: str) -> str:
    """Lowercase + collapse whitespace."""
    return re.sub(r"\s+", " ", raw.strip().lower())


def _normalise_state(raw: str) -> str:
    return raw.strip().title()


def _normalise_district(raw: str) -> str:
    return raw.strip().title()


def _parse_int(value: Any, field: str) -> tuple[int | None, str | None]:
    try:
        v = int(str(value).replace(",", "").strip())
        if v < 0:
            return None, f"{field} is negative ({v})"
        return v, None
    except (ValueError, TypeError):
        return None, f"Cannot parse {field}: {value!r}"


def _parse_year(value: Any) -> tuple[int | None, str | None]:
    n, err = _parse_int(value, "year")
    if err:
        return None, err
    if n is not None and not (1900 < n < 2100):
        return None, f"Year out of range: {n}"
    return n, None


def _parse_float(value: Any) -> float | None:
    try:
        return float(str(value).strip())
    except (ValueError, TypeError):
        return None


# ── Public API ────────────────────────────────────────────────────────────────

class Normaliser:
    def __init__(self, source: str, source_dataset: str) -> None:
        self.source         = source
        self.source_dataset = source_dataset
        self._col_map: dict[str, str] = {}

    def set_columns(self, raw_columns: list[str]) -> None:
        """Call once per file with the header row."""
        self._col_map = _build_reverse_map(raw_columns)
        mapped = list(self._col_map.keys())
        missing = [f for f in ("state","district","crime_category","incident_count","year") if f not in mapped]
        if missing:
            logger.warning("Columns not found in source: %s", missing)

    def normalise(self, raw: dict[str, Any]) -> tuple[CrimeRecord | None, str | None]:
        """
        Normalise one raw row into a CrimeRecord.
        Returns (record, None) on success or (None, reason) on failure.
        """
        m = self._col_map

        # ── Required fields ──────────────────────────────────────────────────
        state_raw = _normalise_str(raw.get(m.get("state",""), ""))
        if not state_raw:
            return None, "missing state"

        district_raw = _normalise_str(raw.get(m.get("district",""), ""))
        if not district_raw:
            return None, "missing district"

        cat_raw = _normalise_str(raw.get(m.get("crime_category",""), ""))
        if not cat_raw:
            return None, "missing crime_category"

        count_raw = raw.get(m.get("incident_count",""))
        count, err = _parse_int(count_raw, "incident_count")
        if err:
            return None, err
        if count == 0:
            # Zero-count records are valid but rarely useful; keep them
            pass

        year_raw = raw.get(m.get("year",""))
        year, err = _parse_year(year_raw)
        if err:
            return None, err

        # ── Optional geometry ─────────────────────────────────────────────
        lat = _parse_float(raw.get(m.get("latitude",""), None))
        lng = _parse_float(raw.get(m.get("longitude",""), None))
        # Reject implausible Indian coordinates (rough bounding box)
        if lat is not None and not (6 < lat < 38):
            lat = None
        if lng is not None and not (68 < lng < 98):
            lng = None

        category = _normalise_category(cat_raw)
        severity = CATEGORY_SEVERITY.get(category, DEFAULT_SEVERITY_WEIGHT)

        # ── Metadata: preserve unrecognised columns ───────────────────────
        recognised_raw = set(m.values())
        metadata = {k: v for k, v in raw.items() if k not in recognised_raw}

        return CrimeRecord(
            state          = _normalise_state(state_raw),
            district       = _normalise_district(district_raw),
            crime_category = category,
            incident_count = count,  # type: ignore[arg-type]  # already validated non-None
            year           = year,   # type: ignore[arg-type]
            source         = self.source,
            source_dataset = self.source_dataset,
            latitude       = lat,
            longitude      = lng,
            severity_weight= severity,
            metadata       = metadata,
        ), None