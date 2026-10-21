# Suraksha Grid — Historical Crime Evidence

## Overview

This document describes the Historical Crime Evidence subsystem introduced in Phase 7.
It is designed to be **dataset-agnostic**: the full infrastructure exists before any NCRB data is present, and the application works normally when the dataset is empty.

---

## 1. Where to put the NCRB dataset

Place the file inside the `data/crime/raw/` directory:

```
data/crime/raw/ncrb_2023.csv      ← CSV
data/crime/raw/ncrb_2023.json     ← JSON (also supported)
```

This directory is excluded from version control (`.gitignore`).
It is safe to place files here and they will never be committed.

---

## 2. Supported formats

| Format | Notes |
|---|---|
| CSV | Any encoding, any column names (see normalisation below) |
| JSON | Array of objects at the top level |

Column names do **not** need to match exactly. The normaliser maps common variants automatically.

---

## 3. How normalisation works

`backend/app/services/crime/normalizer.py` contains a `COLUMN_ALIASES` dictionary that maps **canonical field names** to a list of known source column variants:

```python
"state":          ["state", "state_name", "state/ut", ...]
"crime_category": ["crime_head", "offence", "ipc_category", ...]
"incident_count": ["cases_reported", "total_cases", "no_of_cases", ...]
```

If the NCRB dataset uses a column name not already in the list, add it to `COLUMN_ALIASES` — no other code changes are needed.

**Validation rules applied during normalisation:**
- State, district, crime category must be non-empty strings
- `incident_count` must be a non-negative integer
- `year` must be in the range 1901–2099
- Latitude/longitude (if present) must fall within India's bounding box (6–38 °N, 68–98 °E)
- Records failing any check are counted as **skipped** with a reason, never silently dropped

---

## 4. How to run the import

```bash
# Dry run — parse and validate without writing to the database
python -m backend.scripts.import_crime_data \
  --file data/crime/raw/ncrb_2023.csv \
  --source "NCRB" \
  --dataset "Crime in India 2023" \
  --year 2023 \
  --dry-run

# Live import
python -m backend.scripts.import_crime_data \
  --file data/crime/raw/ncrb_2023.csv \
  --source "NCRB" \
  --dataset "Crime in India 2023" \
  --year 2023

# Flags
#   --source     Provenance label (stored verbatim, shown in UI)
#   --dataset    Dataset name (stored verbatim, shown in UI)
#   --year       Override year (when CSV has no year column)
#   --batch-size DB insert batch size (default 500)
```

The import prints a summary:

```
Import summary (12.4s): 42630/43000 rows imported, 370 skipped — reasons: {'missing state': 210, 'missing district': 160}
```

---

## 5. How geometry is joined

The NCRB dataset typically contains district names but no GIS geometry.
Geometry must be joined separately from a verified administrative boundary file (GeoJSON).

```bash
# After import, attach district polygon geometry
python -m backend.scripts.join_geometry \
  --boundaries data/crime/raw/india_districts.geojson
```

The script:
1. Reads the GeoJSON `features` array
2. Matches each feature's `state_name` + `district_name` to rows in `historical_crime_evidence`
3. Calls the `attach_district_geometry()` PostGIS RPC to set geometry in place
4. Reports how many rows were updated

The GeoJSON must have properties `state_name` (or `STATE_NAME`, `ST_NM`) and `district_name` (or `DISTRICT`, `DIST_NAME`). Add variants to `STATE_KEYS` / `DISTRICT_KEYS` in `join_geometry.py` if needed.

**Geometry is never fabricated.** If no matching boundary is found for a district, that district's rows remain with `geometry = NULL` and are silently excluded from spatial queries.

---

## 6. How route exposure works

The `crime_route_intersections()` PostgreSQL function (migration 005) runs a PostGIS spatial query:

```sql
SELECT ... ST_Length(ST_Intersection(hce.geometry, route)) AS intersection_m
FROM historical_crime_evidence hce
WHERE ST_Intersects(hce.geometry, route)
  AND intersection_length >= MIN_INTERSECTION_METRES
```

For each intersecting area:

```
exposure_fraction = intersection_m / route_length_m
```

A district that only barely clips a corner of the route has a very low exposure fraction and contributes very little to the evidence score.
A district that the route passes through for a significant distance has a higher contribution.

---

## 7. How historical evidence affects the Safety Engine

The integration is **additive and bounded**:

```
final_score = safety_engine_score + score_adjustment
```

Where:
- `safety_engine_score` is the existing deterministic Safety Score (0–100)
- `score_adjustment` is ≤ 0 and ≥ -12 (historical evidence can only reduce the score)
- When `dataset_available = False` the adjustment is exactly 0 (no change)

The adjustment formula:

```
historical_evidence =
    crime_density  × WEIGHTS.density   (0.35)
  + severity_weight× WEIGHTS.severity  (0.30)
  + route_exposure × WEIGHTS.exposure  (0.25)
  + time_weight    × WEIGHTS.time_weight(0.10)

score_adjustment = MAX_ADJUSTMENT × historical_evidence
                 = -12 × [0, 1]
                 = at most -12 points
```

All weights live in `backend/app/services/crime/config.py`.

**This is not an NCRB risk score.** It is a Suraksha Grid model that uses historical district-level data as one evidence signal among many.

---

## 8. Data limitations

These limitations must always be communicated to users:

- Historical crime data is **area-level** (district). It does not indicate that a specific crime occurred on a specific road.
- Data age varies — older records are down-weighted via time decay.
- Geometry coverage depends on the boundary file; districts without geometry are excluded from spatial queries.
- The Safety Score is an **evidence-based index (0–100)**, not a probability of crime.
- NCRB data reflects reported crimes — actual incidence may differ.

The disclaimer string is defined in `config.py` (`SOURCE_DISCLAIMER`) and appears in every API response and in the Safety Lens UI.

---

## 9. How to update to a newer dataset

```bash
# 1. Put the new file in data/crime/raw/
cp ~/Downloads/ncrb_2024.csv data/crime/raw/

# 2. Import (existing rows for previous years are preserved)
python -m backend.scripts.import_crime_data \
  --file data/crime/raw/ncrb_2024.csv \
  --source "NCRB" \
  --dataset "Crime in India 2024" \
  --year 2024

# 3. Optionally re-run geometry join if boundary file changed
python -m backend.scripts.join_geometry \
  --boundaries data/crime/raw/india_districts.geojson
```

The time decay function automatically reduces the influence of older years relative to the new data without any manual intervention.

---

## 10. How to verify the imported data

```bash
# Row count
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM historical_crime_evidence;"

# Breakdown by year and source
psql "$DATABASE_URL" -c "
  SELECT year, source_dataset, COUNT(*) AS rows
  FROM historical_crime_evidence
  GROUP BY year, source_dataset
  ORDER BY year DESC;"

# Check geometry coverage
psql "$DATABASE_URL" -c "
  SELECT
    COUNT(*) FILTER (WHERE geometry IS NOT NULL) AS with_geometry,
    COUNT(*) FILTER (WHERE geometry IS NULL)     AS without_geometry
  FROM historical_crime_evidence;"

# Dry-run import to validate a new file without touching the DB
python -m backend.scripts.import_crime_data \
  --file data/crime/raw/ncrb_2024.csv \
  --source "NCRB" --dataset "Crime in India 2024" --year 2024 \
  --dry-run
```

---

## Architecture reference

```
data/crime/raw/           ← input files (gitignored)
data/crime/processed/     ← intermediate artefacts

backend/
  scripts/
    import_crime_data.py  ← CLI: parse + persist to Supabase
    join_geometry.py      ← CLI: attach PostGIS polygons

  app/services/crime/
    config.py             ← all weights, thresholds, severity map
    models.py             ← canonical data classes
    normalizer.py         ← column-alias mapping + validation
    importer.py           ← CSV/JSON reader + batch DB insert
    spatial.py            ← PostGIS route intersection query
    evidence.py           ← deterministic aggregation model

  app/api/v1/crime.py     ← GET /evidence, POST /route-analysis

supabase/migrations/
  005_historical_crime_evidence.sql  ← table, indexes, RLS, RPCs

src/components/map/
  crime-overlay.ts        ← MapLibre polygon layer (no-op when empty)

src/components/safety/
  safety-lens.tsx         ← shows Historical Evidence section

backend/tests/
  fixtures/crime/         ← SYNTHETIC test data (never for production)
  test_crime.py           ← 27 tests covering all subsystem layers
```