# Suraksha Grid — Crime Evidence Data Directory

## Directory layout

```
data/crime/
  raw/          ← place your NCRB dataset file(s) here (CSV or JSON)
  processed/    ← normalised intermediate files written by the importer
```

## Supported formats

- CSV with any column naming (the normaliser maps columns automatically)
- JSON array of records

The importer is **dataset-agnostic**: it does not require specific column names.
See `docs/historical-crime-evidence.md` for the full mapping reference.

## Quick start (once you have the dataset)

```bash
# 1. Place file here:
cp ~/Downloads/ncrb_2023.csv data/crime/raw/

# 2. Run the import:
python -m backend.scripts.import_crime_data \
  --file data/crime/raw/ncrb_2023.csv \
  --source "NCRB" \
  --dataset "Crime in India 2023" \
  --year 2023

# 3. Optionally join district geometry:
python -m backend.scripts.join_geometry \
  --boundaries data/crime/raw/india_districts.geojson
```

## Safety

- Raw files are excluded from version control (`.gitignore`)
- No crime data is ever fabricated
- Test fixtures live separately in `backend/tests/fixtures/crime/`
