"""
python -m backend.scripts.join_geometry

Joins verified district administrative boundary geometry with existing
historical_crime_evidence rows that have no geometry yet.

Usage:
    python -m backend.scripts.join_geometry \\
        --boundaries data/crime/raw/india_districts_4326.geojson \\
        [--dry-run] \\
        [--report data/crime/unmatched_districts.json]

The GeoJSON must have features with properties:
    state_name   (or STATE_NAME, ST_NM, st_nm, state)
    district_name (or DISTRICT, DIST_NAME, dtname, district)

Geometry is NEVER fabricated. If no matching boundary is found, the row
keeps geometry=NULL and is documented in the unmatched report.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

# ── GeoJSON property keys to try ──────────────────────────────────────────────
STATE_KEYS    = ["state_name", "state", "STATE_NAME", "ST_NM", "st_nm", "stname", "State_Name"]
DISTRICT_KEYS = ["district_name", "district", "DISTRICT", "DIST_NAME", "dtname",
                 "Dist_Name", "district_n", "DISTNAME"]

# ── Known non-territorial NCRB police units (no district boundary exists) ─────
# These are deliberately excluded from the "unmatched" report.
NON_TERRITORIAL_PATTERNS = re.compile(
    r"\b(railway|grp|scrb|ssb|stf|ats|sog|cid|eow|igi\s*airport|cyber|"
    r"metro rail|special crime|spl cell|spuwac|vigilance|crime branch|"
    r"railway police|crime and eou|commissionerate railway)\b",
    re.I,
)

# ── State name alias table ─────────────────────────────────────────────────────
# Maps NCRB state name (normalised) → possible boundary state names (normalised)
STATE_ALIASES: dict[str, list[str]] = {
    "a&n islands": [
        "andaman & nicobar island", "andaman and nicobar island",
        "andaman & nicobar islands", "andaman and nicobar islands",
    ],
    "d&n haveli and daman & diu": [
        "dadra and nagar haveli and daman and diu",
        "dadra & nagar haveli and daman & diu",
        "dadra & nagar haveli & daman & diu",
        "dadra and nagar haveli",
        "daman and diu",
    ],
    "jammu & kashmir": ["jammu & kashmir", "jammu and kashmir"],
    "puducherry": ["puducherry", "pondicherry"],
    "odisha":     ["odisha", "orissa"],
    "uttarakhand": ["uttarakhand", "uttaranchal"],
}

# ── District name alias table ──────────────────────────────────────────────────
# (normalised_ncrb_district, normalised_state) → normalised_boundary_district
DISTRICT_ALIASES: dict[tuple[str, str], str] = {
    # Karnataka
    ("bengaluru city",   "karnataka"): "bengaluru urban",
    ("bengaluru district","karnataka"): "bengaluru rural",
    ("hubballi dharwad city","karnataka"): "dharwad",
    ("mangaluru city",   "karnataka"): "dakshina kannada",
    ("mysuru city",      "karnataka"): "mysuru",
    ("mysuru district",  "karnataka"): "mysuru",
    ("belagavi city",    "karnataka"): "belagavi",
    ("belagavi district","karnataka"): "belagavi",
    ("kalaburgi city",   "karnataka"): "kalaburagi",
    ("kalaburgi",        "karnataka"): "kalaburagi",
    ("kgf",              "karnataka"): "kolar",
    ("vijayanagara",     "karnataka"): "vijayanagara",
    # Maharashtra
    ("mumbai commr",     "maharashtra"): "mumbai",
    ("pune commr",       "maharashtra"): "pune",
    ("nagpur commr",     "maharashtra"): "nagpur",
    ("nasik commr",      "maharashtra"): "nashik",
    ("nasik rural",      "maharashtra"): "nashik",
    ("amravati commr",   "maharashtra"): "amravati",
    ("amravati rural",   "maharashtra"): "amravati",
    ("solapur commr",    "maharashtra"): "solapur",
    ("solapur rural",    "maharashtra"): "solapur",
    ("navi mumbai",      "maharashtra"): "thane",
    ("thane commr",      "maharashtra"): "thane",
    ("thane rural",      "maharashtra"): "thane",
    ("pimpri chinchwad city","maharashtra"): "pune",
    ("mira bhayandar vasai virar commr","maharashtra"): "thane",
    ("chhatrapati sambhajinagar commr","maharashtra"): "chhatrapati sambhajinagar",
    ("chhatrapati sambhajinagar rural","maharashtra"): "chhatrapati sambhajinagar",
    ("dharashiv",        "maharashtra"): "osmanabad",
    # Telangana
    ("cyberabad commissionerate","telangana"): "rangareddy",
    ("hyderabad commr",  "telangana"): "hyderabad",
    # Rajasthan — Jaipur is split in NCRB
    ("jaipur east",      "rajasthan"): "jaipur",
    ("jaipur west",      "rajasthan"): "jaipur",
    ("jaipur north",     "rajasthan"): "jaipur",
    ("jaipur south",     "rajasthan"): "jaipur",
    ("jaipur rural",     "rajasthan"): "jaipur",
    ("jaipur metro",     "rajasthan"): "jaipur",
    ("jaipur crime",     "rajasthan"): "jaipur",
    ("jodhpur east",     "rajasthan"): "jodhpur",
    ("jodhpur west",     "rajasthan"): "jodhpur",
    ("jodhpur rural",    "rajasthan"): "jodhpur",
    ("jodhpur crime",    "rajasthan"): "jodhpur",
    ("kota city",        "rajasthan"): "kota",
    ("kota rural",       "rajasthan"): "kota",
    ("anupgarh",         "rajasthan"): "sriganganagar",
    ("balotra",          "rajasthan"): "barmer",
    ("beawar",           "rajasthan"): "ajmer",
    ("bhiwadi",          "rajasthan"): "alwar",
    ("deeg",             "rajasthan"): "bharatpur",
    ("didwana-kuchaman", "rajasthan"): "nagaur",
    ("dudu",             "rajasthan"): "jaipur",
    ("gangapur city",    "rajasthan"): "sawai madhopur",
    ("kekri",            "rajasthan"): "ajmer",
    ("khairtal-tijara",  "rajasthan"): "alwar",
    ("kotputli-behror",  "rajasthan"): "jaipur",
    ("neem ka thana",    "rajasthan"): "sikar",
    ("phalodi",          "rajasthan"): "jodhpur",
    ("sanchore",         "rajasthan"): "jalore",
    ("salumbar",         "rajasthan"): "udaipur",
    ("shahpura",         "rajasthan"): "bhilwara",
    # Kerala commissioner units
    ("ernakulam commr",  "kerala"): "ernakulam",
    ("kozhikode commr",  "kerala"): "kozhikode",
    ("kollam commr",     "kerala"): "kollam",
    ("thrissur commr",   "kerala"): "thrissur",
    ("trivandrum commr", "kerala"): "thiruvananthapuram",
    # Andhra Pradesh
    ("vijayawada commr", "andhra pradesh"): "krishna",
    ("viiayawada railway","andhra pradesh"): "krishna",
    # Assam
    ("commissionerate",  "assam"): "kamrup metropolitan",
    # Delhi (all police districts map to the single 'Delhi' boundary unit)
    ("central",      "delhi"): "new delhi",
    ("east",         "delhi"): "east delhi",
    ("north",        "delhi"): "north delhi",
    ("north-east",   "delhi"): "north east delhi",
    ("north-west",   "delhi"): "north west delhi",
    ("outer",        "delhi"): "west delhi",
    ("outer north",  "delhi"): "north west delhi",
    ("rohini",       "delhi"): "north west delhi",
    ("south",        "delhi"): "south delhi",
    ("south-east",   "delhi"): "south east delhi",
    ("south-west",   "delhi"): "south west delhi",
    ("shahdara",     "delhi"): "east delhi",
    ("west",         "delhi"): "west delhi",
    ("dwarka",       "delhi"): "south west delhi",
    ("new delhi",    "delhi"): "new delhi",
    # J&K splits
    ("crime",        "jammu & kashmir"): "jammu",
}


def _get_prop(props: dict, keys: list[str]) -> str:
    for k in keys:
        if k in props and props[k]:
            return str(props[k]).strip()
    return ""


def _normalize(s: str) -> str:
    """Lowercase, collapse whitespace, strip punctuation for fuzzy matching."""
    s = s.lower().strip()
    s = re.sub(r"[&]", "and", s)
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _is_non_territorial(district: str) -> bool:
    return bool(NON_TERRITORIAL_PATTERNS.search(district))


def _strip_suffixes(s: str) -> str:
    """Remove administrative suffixes to help matching."""
    for sfx in (" commr", " commissionerate", " commissioner", " city",
                 " district", " rural", " urban", " range", " wing",
                 " cell", " branch"):
        if s.endswith(sfx):
            s = s[: -len(sfx)].strip()
    return s


def _geojson_to_wkt(geom: dict) -> str | None:
    """Minimal GeoJSON → WKT for Polygon / MultiPolygon / Point."""
    def ring(pts: list) -> str:
        return "(" + ", ".join(f"{x} {y}" for x, y in pts) + ")"

    geom_type = geom.get("type", "")
    coords = geom.get("coordinates")
    if not coords:
        return None
    if geom_type == "Polygon":
        return f"POLYGON({', '.join(ring(r) for r in coords)})"
    if geom_type == "MultiPolygon":
        polys = ", ".join("(" + ", ".join(ring(r) for r in poly) + ")" for poly in coords)
        return f"MULTIPOLYGON({polys})"
    if geom_type == "Point":
        return f"POINT({coords[0]} {coords[1]})"
    logger.warning("Unsupported geometry type: %s", geom_type)
    return None


def build_boundary_index(
    features: list[dict],
) -> dict[tuple[str, str], str]:
    """
    Build a lookup: (norm_state, norm_district) → WKT geometry string.
    Also stores stripped-suffix variants so matching is more robust.
    """
    index: dict[tuple[str, str], str] = {}
    skipped = 0
    for feat in features:
        props = feat.get("properties") or {}
        state_raw = _get_prop(props, STATE_KEYS)
        dist_raw  = _get_prop(props, DISTRICT_KEYS)
        geom_raw  = feat.get("geometry")
        if not state_raw or not dist_raw or not geom_raw:
            skipped += 1
            continue
        wkt = _geojson_to_wkt(geom_raw)
        if not wkt:
            skipped += 1
            continue

        ns = _normalize(state_raw)
        nd = _normalize(dist_raw)
        index[(ns, nd)] = wkt

        # Also store with stripped suffixes
        nd_stripped = _strip_suffixes(nd)
        if nd_stripped != nd:
            index.setdefault((ns, nd_stripped), wkt)

    logger.info("Boundary index: %d entries (%d features skipped)", len(index), skipped)
    return index


def match_ncrb_to_boundary(
    ncrb_state: str,
    ncrb_district: str,
    index: dict[tuple[str, str], str],
) -> tuple[Optional[str], str]:
    """
    Try to find a boundary WKT for an NCRB (state, district) pair.
    Returns (wkt_or_None, match_type) where match_type is one of:
        "exact", "normalized", "alias", "stripped", "non_territorial", "unmatched"
    """
    ns_ncrb = _normalize(ncrb_state)
    nd_ncrb = _normalize(ncrb_district)

    # Non-territorial units get a fast exit
    if _is_non_territorial(ncrb_district):
        return None, "non_territorial"

    # Collect candidate state normalizations (NCRB state + known aliases)
    state_candidates = [ns_ncrb]
    for alias_state, alias_targets in STATE_ALIASES.items():
        if ns_ncrb == alias_state or ns_ncrb in [_normalize(t) for t in alias_targets]:
            state_candidates = [alias_state] + [_normalize(t) for t in alias_targets] + state_candidates

    # 1. Direct alias lookup (highest priority)
    alias_key = (nd_ncrb, ns_ncrb)
    if alias_key in DISTRICT_ALIASES:
        nd_mapped = DISTRICT_ALIASES[alias_key]
        for sc in state_candidates:
            wkt = index.get((sc, nd_mapped))
            if wkt:
                return wkt, "alias"

    # 2. Exact normalized match
    for sc in state_candidates:
        wkt = index.get((sc, nd_ncrb))
        if wkt:
            return wkt, "exact" if sc == ns_ncrb else "normalized"

    # 3. Stripped suffix match
    nd_stripped = _strip_suffixes(nd_ncrb)
    if nd_stripped != nd_ncrb:
        for sc in state_candidates:
            wkt = index.get((sc, nd_stripped))
            if wkt:
                return wkt, "stripped"

    return None, "unmatched"


async def main(args: argparse.Namespace) -> int:
    from app.db.client import get_supabase

    path = Path(args.boundaries)
    if not path.exists():
        logger.error("Boundary file not found: %s", path)
        return 1

    with open(path, encoding="utf-8") as f:
        geojson = json.load(f)

    features = geojson.get("features", [])
    logger.info("Loaded %d boundary features from %s", len(features), path)

    index = build_boundary_index(features)

    db = None
    null_pairs: list[dict] = []

    if not args.dry_run:
        db = get_supabase()
    else:
        try:
            db = get_supabase()
        except Exception:
            logger.info("Database credentials not configured — running offline dry-run matching against data/crime/ncrb_2023_combined.csv")

    if db is not None:
        # ── Fetch all NULL-geometry (state, district) pairs from DB ───────────────
        try:
            resp = db.rpc("list_null_geometry_districts", {}).execute()
            null_pairs = resp.data or []
        except Exception:
            # Fallback: query directly (if RPC not yet applied)
            resp = (
                db.table("historical_crime_evidence")
                .select("state, district")
                .is_("geometry", "null")
                .execute()
            )
            seen: set[tuple[str, str]] = set()
            null_pairs = []
            for row in (resp.data or []):
                k = (row["state"], row["district"])
                if k not in seen:
                    seen.add(k)
                    null_pairs.append({"state": k[0], "district": k[1], "record_count": 1})
    else:
        # Read from local combined CSV
        import csv
        csv_path = Path("data/crime/ncrb_2023_combined.csv")
        seen_map: dict[tuple[str, str], int] = {}
        if csv_path.exists():
            with open(csv_path, encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for r in reader:
                    st = r.get("state") or r.get("State") or ""
                    dist = r.get("district") or r.get("District") or ""
                    if st and dist:
                        key = (st.strip(), dist.strip())
                        seen_map[key] = seen_map.get(key, 0) + 1
        null_pairs = [{"state": k[0], "district": k[1], "record_count": cnt} for k, cnt in seen_map.items()]

    logger.info("Found %d distinct (state, district) pairs to match", len(null_pairs))

    # ── Match and attach ───────────────────────────────────────────────────────
    results: dict[str, list[dict]] = {
        "exact": [], "normalized": [], "alias": [], "stripped": [],
        "non_territorial": [], "unmatched": [],
    }

    attached_rows = 0
    errors        = 0

    for pair in null_pairs:
        state    = pair["state"]
        district = pair["district"]
        count    = pair.get("record_count", "?")

        wkt, match_type = match_ncrb_to_boundary(state, district, index)

        results[match_type].append({
            "state": state, "district": district, "record_count": count
        })

        if wkt is None:
            continue  # non_territorial or unmatched — leave geometry NULL

        if args.dry_run:
            logger.info("[DRY-RUN] Would attach: %s / %s (%s)", state, district, match_type)
            continue

        try:
            resp = db.rpc("attach_district_geometry", {
                "p_state":    state,
                "p_district": district,
                "p_geometry": f"SRID=4326;{wkt}",
            }).execute()
            n = resp.data or 0
            attached_rows += n
            logger.debug("Attached %d rows: %s / %s (%s)", n, state, district, match_type)
        except Exception as exc:
            logger.warning("Failed to attach %s / %s: %s", state, district, exc)
            errors += 1

    # ── Summary ───────────────────────────────────────────────────────────────
    attached_pairs = sum(
        len(results[k]) for k in ("exact", "normalized", "alias", "stripped")
    )
    non_territorial = len(results["non_territorial"])
    unmatched       = len(results["unmatched"])

    logger.info(
        "Geometry join %s: %d pairs matched (%d DB rows), "
        "%d non-territorial, %d unmatched, %d errors",
        "(DRY-RUN)" if args.dry_run else "complete",
        attached_pairs, attached_rows, non_territorial, unmatched, errors,
    )
    if results["unmatched"]:
        logger.warning(
            "Unmatched districts (genuine boundary data missing): %s",
            [(r["state"], r["district"]) for r in results["unmatched"]],
        )

    # ── Write report ──────────────────────────────────────────────────────────
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "summary": {
            "null_geometry_pairs":  len(null_pairs),
            "attached_pairs":       attached_pairs,
            "attached_db_rows":     attached_rows,
            "non_territorial":      non_territorial,
            "unmatched":            unmatched,
            "errors":               errors,
            "dry_run":              args.dry_run,
        },
        "match_breakdown": {k: len(v) for k, v in results.items()},
        "unmatched_districts": results["unmatched"],
        "non_territorial_units": results["non_territorial"],
    }
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    logger.info("Report written to %s", report_path)

    return 0 if errors == 0 else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Join district geometry with crime evidence rows")
    parser.add_argument("--boundaries", required=True,
                        help="Path to GeoJSON boundary file (EPSG:4326)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Parse and match without writing to DB")
    parser.add_argument("--report", default="data/crime/unmatched_districts.json",
                        help="Output path for the unmatched-districts JSON report")
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args)))
