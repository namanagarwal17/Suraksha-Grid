from pathlib import Path
import pandas as pd


INPUT_FILE = Path("data/crime/raw/ncrb_2023_ipc.xlsx")
OUTPUT_FILE = Path("data/crime/raw/ncrb_2023.csv")


def main():
    if not INPUT_FILE.exists():
        raise FileNotFoundError(
            f"NCRB file not found: {INPUT_FILE}"
        )

    # NCRB workbook uses the "District Data Report" sheet.
    df = pd.read_excel(
        INPUT_FILE,
        sheet_name="District Data Report",
        header=None,
    )

    records = []
    current_state = None

    # Data starts from row 8 in the Excel sheet.
    for row_index in range(7, len(df)):
        first = df.iat[row_index, 0]
        second = df.iat[row_index, 1]

        # State marker, e.g. "State: Andhra Pradesh"
        if isinstance(first, str) and first.startswith("State:"):
            current_state = first.split(":", 1)[1].strip()
            continue

        # District rows have a numeric S.No and district name.
        if (
            pd.notna(first)
            and str(first).strip().isdigit()
            and pd.notna(second)
            and current_state
        ):
            district = str(second).strip()

            # Column 143 = Total Cognizable IPC crimes
            crime_count = pd.to_numeric(
                df.iat[row_index, 143],
                errors="coerce",
            )

            if pd.isna(crime_count):
                continue

            records.append(
                {
                    "state": current_state,
                    "district": district,
                    "crime_category": "total_cognizable_ipc_crimes",
                    "incident_count": int(crime_count),
                    "year": 2023,
                }
            )

    result = pd.DataFrame(records)

    if result.empty:
        raise RuntimeError("No NCRB district records were extracted.")

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(OUTPUT_FILE, index=False)

    print(f"Created: {OUTPUT_FILE}")
    print(f"Records: {len(result)}")
    print()
    print(result.head(10).to_string(index=False))


if __name__ == "__main__":
    main()