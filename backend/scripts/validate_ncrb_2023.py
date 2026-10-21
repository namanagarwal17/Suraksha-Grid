from pathlib import Path
import pandas as pd


INPUT_FILE = Path("data/crime/ncrb_2023_combined.csv")


def main():
    if not INPUT_FILE.exists():
        raise FileNotFoundError(f"File not found: {INPUT_FILE}")

    df = pd.read_csv(INPUT_FILE)

    required = {
        "state",
        "district",
        "crime_category",
        "incident_count",
        "year",
    }

    missing = required - set(df.columns)

    if missing:
        raise ValueError(f"Missing columns: {sorted(missing)}")

    print("=" * 60)
    print("NCRB DATA VALIDATION")
    print("=" * 60)

    print(f"Total records: {len(df)}")
    print(f"States: {df['state'].nunique()}")
    print(f"Districts: {df['district'].nunique()}")
    print(f"Years: {sorted(df['year'].unique())}")

    print("\nRecords by category:")
    print(df["crime_category"].value_counts().to_string())

    print("\nMissing values:")
    print(df.isna().sum().to_string())

    print("\nNegative crime counts:")
    print((df["incident_count"] < 0).sum())

    duplicates = df.duplicated(
        subset=[
            "state",
            "district",
            "crime_category",
            "year",
        ]
    ).sum()

    print(f"\nDuplicate records: {duplicates}")

    invalid_years = df.loc[
        df["year"] != 2023
    ]

    print(f"Non-2023 records: {len(invalid_years)}")

    print("\nSample:")
    print(df.head(10).to_string(index=False))

    # Hard validation
    if duplicates > 0:
        raise RuntimeError(
            f"Validation failed: {duplicates} duplicate records found."
        )

    if (df["incident_count"] < 0).any():
        raise RuntimeError(
            "Validation failed: negative crime counts found."
        )

    if invalid_years.shape[0] > 0:
        raise RuntimeError(
            "Validation failed: non-2023 records found."
        )

    print("\n" + "=" * 60)
    print("VALIDATION PASSED")
    print("=" * 60)


if __name__ == "__main__":
    main()