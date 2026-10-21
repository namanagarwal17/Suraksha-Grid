"""
Crime data importer — CSV and JSON.

Works with any CSV / JSON whose column names appear in the normaliser's
COLUMN_ALIASES mapping. No code changes needed to add a new source dataset
— just add column aliases to normalizer.py COLUMN_ALIASES if needed.

Usage:
    python -m backend.scripts.import_crime_data \\
        --file data/crime/raw/ncrb_2023.csv \\
        --source "NCRB" \\
        --dataset "Crime in India 2023" \\
        --year 2023
"""
from __future__ import annotations

import csv
import json
import logging
import os
from pathlib import Path
from typing import Any, Iterator

from app.services.crime.models import CrimeRecord, ImportSummary
from app.services.crime.normalizer import Normaliser

logger = logging.getLogger(__name__)


# ── File readers ──────────────────────────────────────────────────────────────

def _read_csv(path: Path) -> Iterator[tuple[list[str], dict[str, Any]]]:
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            return
        yield list(reader.fieldnames), {}  # sentinel with headers
        for row in reader:
            yield [], dict(row)             # actual rows


def _read_json(path: Path) -> Iterator[tuple[list[str], dict[str, Any]]]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list) or not data:
        return
    yield list(data[0].keys()), {}          # sentinel with headers
    for row in data:
        yield [], dict(row)


def _choose_reader(path: Path):
    ext = path.suffix.lower()
    if ext == ".csv":
        return _read_csv(path)
    if ext == ".json":
        return _read_json(path)
    raise ValueError(f"Unsupported file format: {ext}. Supported: .csv, .json")


# ── Importer ──────────────────────────────────────────────────────────────────

class CrimeDataImporter:
    """
    Dataset-agnostic importer.

    1. Reads the file header and wires the normaliser's column map.
    2. Iterates rows, normalises, validates, collects records.
    3. Delegates persistence to a Supabase client passed at call time.
    """

    def __init__(
        self,
        source: str,
        source_dataset: str,
        year_override: int | None = None,
    ) -> None:
        self.source         = source
        self.source_dataset = source_dataset
        self.year_override  = year_override
        self._normaliser    = Normaliser(source, source_dataset)

    def parse(self, path: Path) -> tuple[list[CrimeRecord], ImportSummary]:
        """
        Parse and normalise a file without writing to the database.
        Returns (records, summary).
        """
        if not path.exists():
            raise FileNotFoundError(f"Dataset file not found: {path}")

        summary = ImportSummary(source_file=str(path), total_rows=0, imported=0, skipped=0)
        records: list[CrimeRecord] = []
        header_done = False

        for headers, row in _choose_reader(path):
            if headers:
                self._normaliser.set_columns(headers)
                header_done = True
                continue
            if not header_done:
                logger.error("No header row found in %s", path)
                break

            summary.total_rows += 1
            record, reason = self._normaliser.normalise(row)
            if reason:
                summary.skipped += 1
                summary.skip_reasons[reason] = summary.skip_reasons.get(reason, 0) + 1
                continue

            # Apply year override (useful when the CSV has no year column)
            if self.year_override is not None and record is not None:
                record = CrimeRecord(
                    **{**record.__dict__, "year": self.year_override}
                )

            if record is not None:
                records.append(record)
                summary.imported += 1

        summary.finish()
        logger.info(str(summary))
        return records, summary

    async def import_to_db(
        self,
        path: Path,
        db,        # supabase Client
        batch_size: int = 500,
    ) -> ImportSummary:
        """
        Parse and write to the historical_crime_evidence table in batches.
        Raises on connection failure; individual bad records are counted in summary.
        """
        records, summary = self.parse(path)
        if not records:
            logger.warning("No valid records to import from %s", path)
            return summary

        batches = [records[i:i+batch_size] for i in range(0, len(records), batch_size)]
        for i, batch in enumerate(batches):
            rows = []
            for r in batch:
                row: dict[str, Any] = {
                    "state":          r.state,
                    "district":       r.district,
                    "crime_category": r.crime_category,
                    "incident_count": r.incident_count,
                    "year":           r.year,
                    "source":         r.source,
                    "source_dataset": r.source_dataset,
                    "severity_weight":r.severity_weight,
                    "metadata":       r.metadata or {},
                }
                if r.latitude is not None and r.longitude is not None:
                    # PostGIS WKT POINT — Supabase accepts this as geometry
                    row["geometry"] = f"SRID=4326;POINT({r.longitude} {r.latitude})"
                rows.append(row)

            resp = db.table("historical_crime_evidence").insert(rows).execute()
            if hasattr(resp, "error") and resp.error:
                raise RuntimeError(f"Batch {i+1} insert failed: {resp.error}")
            logger.info("Inserted batch %d/%d (%d rows)", i+1, len(batches), len(batch))

        return summary