from pathlib import Path
import pandas as pd


INPUT_FILE = Path("data/crime/raw/ncrb_2023_women.xlsx")
OUTPUT_FILE = Path("data/crime/raw/ncrb_2023_women.csv")


def main():
    if not INPUT_FILE.exists():
        raise FileNotFoundError(
            f"NCRB women dataset not found: {INPUT_FILE}"
        )

    df = pd.read_excel(
        INPUT_FILE,
        sheet_name="District Data Report",
        header=None,
    )

    records = []
    current_state = None

    for row_index in range(7, len(df)):
        first = df.iat[row_index, 0]
        second = df.iat[row_index, 1]

        # State marker
        if isinstance(first, str) and first.startswith("State:"):
            current_state = first.split(":", 1)[1].strip()
            continue

        # District row
        if (
            pd.notna(first)
            and str(first).strip().isdigit()
            and pd.notna(second)
            and current_state
        ):
            district = str(second).strip()

            # Last column:
            # Total Crime against Women (IPC+SLL)
            crime_count = pd.to_numeric(
                df.iat[row_index, 53],
                errors="coerce",
            )

            if pd.isna(crime_count):
                continue

            records.append(
                {
                    "state": current_state,
                    "district": district,
                    "crime_category": "crime_against_women_ipc_sll",
                    "incident_count": int(crime_count),
                    "year": 2023,
                }
            )

    result = pd.DataFrame(records)

    if result.empty:
        raise RuntimeError(
            "No district records were extracted from the NCRB women dataset."
        )

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(OUTPUT_FILE, index=False)

    print(f"Created: {OUTPUT_FILE}")
    print(f"Records: {len(result)}")
    print()
    print(result.head(10).to_string(index=False))


if __name__ == "__main__":
    main()