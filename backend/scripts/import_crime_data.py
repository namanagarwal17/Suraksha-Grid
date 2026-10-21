"""
python -m backend.scripts.import_crime_data

Imports a historical crime dataset file into Supabase.
No code changes needed for new datasets — just run with the new file.

Usage:
    python -m backend.scripts.import_crime_data \\
        --file data/crime/raw/ncrb_2023.csv \\
        --source "NCRB" \\
        --dataset "Crime in India 2023" \\
        --year 2023        # optional: override year when CSV has no year column

Options:
    --file       Path to CSV or JSON dataset file (required)
    --source     Data source name, e.g. "NCRB" (required)
    --dataset    Dataset name, e.g. "Crime in India 2023" (required)
    --year       Year override — used when file has no year column
    --dry-run    Parse and validate without writing to DB
    --batch-size Rows per DB insert batch (default 500)
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def main(args: argparse.Namespace) -> int:
    from app.services.crime.importer import CrimeDataImporter

    path = Path(args.file)
    importer = CrimeDataImporter(
        source         = args.source,
        source_dataset = args.dataset,
        year_override  = args.year,
    )

    if args.dry_run:
        logger.info("DRY RUN — parsing only, no DB writes")
        records, summary = importer.parse(path)
        print(summary)
        if records:
            print(f"Sample record: {vars(records[0])}")
        return 0

    # Live import
    from app.db.client import get_supabase
    db = get_supabase()
    summary = await importer.import_to_db(path, db, batch_size=args.batch_size)
    print(summary)
    return 0 if summary.skipped == 0 or summary.imported > 0 else 1


def cli() -> None:
    parser = argparse.ArgumentParser(description="Import historical crime data into Suraksha Grid")
    parser.add_argument("--file",       required=True, help="Path to CSV or JSON file")
    parser.add_argument("--source",     required=True, help='Source name, e.g. "NCRB"')
    parser.add_argument("--dataset",    required=True, help='Dataset name, e.g. "Crime in India 2023"')
    parser.add_argument("--year",       type=int, default=None, help="Year override (optional)")
    parser.add_argument("--dry-run",    action="store_true", help="Validate without writing to DB")
    parser.add_argument("--batch-size", type=int, default=500)
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args)))


if __name__ == "__main__":
    cli()