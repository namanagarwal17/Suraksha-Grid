from pathlib import Path
import pandas as pd


RAW_DIR = Path("data/crime/raw")
OUTPUT_FILE = Path("data/crime/ncrb_2023_combined.csv")

FILES = [
    "ncrb_2023.csv",
    "ncrb_2023_women.csv",
    "ncrb_2023_children.csv",
    "ncrb_2023_sll.csv",
]


def main():
    frames = []

    for filename in FILES:
        path = RAW_DIR / filename

        if not path.exists():
            raise FileNotFoundError(f"Dataset not found: {path}")

        df = pd.read_csv(path)

        required = {
            "state",
            "district",
            "crime_category",
            "incident_count",
            "year",
        }

        missing = required - set(df.columns)

        if missing:
            raise ValueError(
                f"{filename} is missing columns: {sorted(missing)}"
            )

        df = df[
            [
                "state",
                "district",
                "crime_category",
                "incident_count",
                "year",
            ]
        ].copy()

        df["state"] = df["state"].astype(str).str.strip()
        df["district"] = df["district"].astype(str).str.strip()
        df["crime_category"] = (
            df["crime_category"].astype(str).str.strip()
        )
        df["incident_count"] = pd.to_numeric(
            df["incident_count"],
            errors="coerce",
        )

        df = df.dropna(
            subset=[
                "state",
                "district",
                "crime_category",
                "incident_count",
            ]
        )

        frames.append(df)

        print(f"{filename}: {len(df)} records")

    combined = pd.concat(frames, ignore_index=True)

    # Remove exact duplicates only.
    # Different crime categories for the same district are intentionally kept.
    combined = combined.drop_duplicates(
        subset=[
            "state",
            "district",
            "crime_category",
            "year",
        ]
    )

    combined["incident_count"] = (
        combined["incident_count"]
        .round()
        .astype(int)
    )

    combined = combined.sort_values(
        ["state", "district", "crime_category"]
    ).reset_index(drop=True)

    OUTPUT_FILE.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    combined.to_csv(
        OUTPUT_FILE,
        index=False,
    )

    print()
    print("=" * 60)
    print("NCRB COMBINATION COMPLETE")
    print("=" * 60)
    print(f"Output: {OUTPUT_FILE}")
    print(f"Total records: {len(combined)}")
    print()
    print("Records by category:")

    print(
        combined["crime_category"]
        .value_counts()
        .to_string()
    )

    print()
    print("States:", combined["state"].nunique())
    print("Districts:", combined["district"].nunique())
    print("Years:", sorted(combined["year"].unique()))


if __name__ == "__main__":
    main()