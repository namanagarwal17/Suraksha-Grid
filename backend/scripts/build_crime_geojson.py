"""
Generate processed, lightweight GeoJSON for NCRB 2023 district crime evidence.
Combines official NCRB 2023 historical records with Survey of India district boundaries.
Geometry is simplified using Ramer-Douglas-Peucker (RDP) for high-performance rendering.
"""
import csv
import json
import logging
from pathlib import Path
import sys

# Add parent directory for imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.join_geometry import (
    STATE_KEYS,
    DISTRICT_KEYS,
    STATE_ALIASES,
    DISTRICT_ALIASES,
    _get_prop,
    _normalize,
    _is_non_territorial,
    _strip_suffixes,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def rdp(points: list, epsilon: float) -> list:
    """Ramer-Douglas-Peucker polygon simplification."""
    if len(points) < 3:
        return points
    dmax = 0.0
    index = 0
    end = len(points) - 1
    x1, y1 = points[0][0], points[0][1]
    x2, y2 = points[end][0], points[end][1]
    dx = x2 - x1
    dy = y2 - y1
    denom = dx * dx + dy * dy

    for i in range(1, end):
        px, py = points[i][0], points[i][1]
        if denom == 0:
            dist = (px - x1) ** 2 + (py - y1) ** 2
        else:
            u = ((px - x1) * dx + (py - y1) * dy) / denom
            u = max(0.0, min(1.0, u))
            dist = (px - (x1 + u * dx)) ** 2 + (py - (y1 + u * dy)) ** 2
        if dist > dmax:
            index = i
            dmax = dist

    if dmax > epsilon * epsilon:
        rec1 = rdp(points[: index + 1], epsilon)
        rec2 = rdp(points[index:], epsilon)
        return rec1[:-1] + rec2
    else:
        return [points[0], points[end]]


def simplify_geometry(geom: dict, epsilon: float = 0.005) -> dict:
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if not coords:
        return geom

    if gtype == "Polygon":
        new_rings = []
        for ring in coords:
            sim = rdp(ring, epsilon)
            if len(sim) >= 4:
                # Ensure closed ring
                if sim[0] != sim[-1]:
                    sim.append(sim[0])
                new_rings.append(sim)
            elif len(ring) >= 4:
                new_rings.append(ring)
        return {"type": "Polygon", "coordinates": new_rings or coords}

    elif gtype == "MultiPolygon":
        new_polys = []
        for poly in coords:
            new_rings = []
            for ring in poly:
                sim = rdp(ring, epsilon)
                if len(sim) >= 4:
                    if sim[0] != sim[-1]:
                        sim.append(sim[0])
                    new_rings.append(sim)
                elif len(ring) >= 4:
                    new_rings.append(ring)
            if new_rings:
                new_polys.append(new_rings)
        return {"type": "MultiPolygon", "coordinates": new_polys or coords}

    return geom


def build_geom_index(features: list[dict]) -> dict:
    index = {}
    for feat in features:
        props = feat.get("properties") or {}
        st = _get_prop(props, STATE_KEYS)
        dt = _get_prop(props, DISTRICT_KEYS)
        geom = feat.get("geometry")
        if not st or not dt or not geom:
            continue
        ns = _normalize(st)
        nd = _normalize(dt)
        index[(ns, nd)] = geom
        nd_str = _strip_suffixes(nd)
        if nd_str != nd:
            index.setdefault((ns, nd_str), geom)
    return index


def match_geom(state: str, district: str, index: dict):
    ns = _normalize(state)
    nd = _normalize(district)
    if _is_non_territorial(district):
        return None

    state_cands = [ns]
    for as_, at in STATE_ALIASES.items():
        if ns == as_ or ns in [_normalize(t) for t in at]:
            state_cands = [as_] + [_normalize(t) for t in at] + state_cands

    alias_k = (nd, ns)
    if alias_k in DISTRICT_ALIASES:
        nd_map = DISTRICT_ALIASES[alias_k]
        for sc in state_cands:
            g = index.get((sc, nd_map))
            if g:
                return g

    for sc in state_cands:
        g = index.get((sc, nd))
        if g:
            return g

    nd_str = _strip_suffixes(nd)
    if nd_str != nd:
        for sc in state_cands:
            g = index.get((sc, nd_str))
            if g:
                return g

    return None


def main():
    root = Path(__file__).resolve().parent.parent.parent
    boundary_path = root / "data" / "crime" / "raw" / "india_districts_4326.geojson"
    csv_path = root / "data" / "crime" / "ncrb_2023_combined.csv"
    out_dir = root / "data" / "crime" / "processed"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "ncrb_districts_geojson.json"

    backend_out_dir = root / "backend" / "data" / "crime" / "processed"
    backend_out_dir.mkdir(parents=True, exist_ok=True)
    backend_out_path = backend_out_dir / "ncrb_districts_geojson.json"

    if not boundary_path.exists():
        logger.error("Boundary file not found: %s", boundary_path)
        return 1
    if not csv_path.exists():
        logger.error("CSV file not found: %s", csv_path)
        return 1

    logger.info("Loading boundaries from %s...", boundary_path)
    with open(boundary_path, "r", encoding="utf-8") as f:
        boundaries = json.load(f)
    features = boundaries.get("features", [])
    logger.info("Loaded %d boundaries. Indexing...", len(features))
    geom_index = build_geom_index(features)

    logger.info("Loading NCRB records from %s...", csv_path)
    records_by_district = {}
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for r in reader:
            st = (r.get("state") or "").strip()
            dt = (r.get("district") or "").strip()
            cat = (r.get("crime_category") or "").strip()
            cnt = int(r.get("incident_count") or 0)
            if not st or not dt:
                continue
            key = (st, dt)
            if key not in records_by_district:
                records_by_district[key] = {
                    "state": st,
                    "district": dt,
                    "total_incidents": 0,
                    "women_cases": 0,
                    "children_cases": 0,
                    "ipc_cases": 0,
                    "sll_cases": 0,
                    "categories": {},
                }
            entry = records_by_district[key]
            entry["total_incidents"] += cnt
            entry["categories"][cat] = cnt
            if "women" in cat:
                entry["women_cases"] += cnt
            elif "children" in cat:
                entry["children_cases"] += cnt
            elif "ipc" in cat:
                entry["ipc_cases"] += cnt
            elif "sll" in cat:
                entry["sll_cases"] += cnt

    logger.info("Found %d distinct NCRB districts. Matching boundaries...", len(records_by_district))

    out_features = []
    matched = 0
    for (st, dt), data in records_by_district.items():
        raw_geom = match_geom(st, dt, geom_index)
        if not raw_geom:
            continue

        matched += 1
        sim_geom = simplify_geometry(raw_geom, epsilon=0.005)

        tot = data["total_incidents"]
        # Determine severity and evidence level
        if tot >= 10000:
            evidence_level = "HIGH"
            severity_weight = 0.85
        elif tot >= 3000:
            evidence_level = "MODERATE"
            severity_weight = 0.60
        elif tot >= 500:
            evidence_level = "LOW"
            severity_weight = 0.40
        else:
            evidence_level = "LOW"
            severity_weight = 0.25

        # Bump severity if crimes against women or children are unusually high
        sensitive_cases = data["women_cases"] + data["children_cases"]
        if sensitive_cases >= 1000:
            severity_weight = min(1.0, severity_weight + 0.15)
            if evidence_level != "HIGH":
                evidence_level = "MODERATE"

        out_features.append({
            "type": "Feature",
            "properties": {
                "district": dt,
                "state": st,
                "year": 2023,
                "source": "NCRB",
                "source_dataset": "Crime in India 2023",
                "total_incidents": tot,
                "women_cases": data["women_cases"],
                "children_cases": data["children_cases"],
                "ipc_cases": data["ipc_cases"],
                "sll_cases": data["sll_cases"],
                "severity_weight": round(severity_weight, 2),
                "evidence_level": evidence_level,
            },
            "geometry": sim_geom,
        })

    logger.info("Matched %d districts. Writing GeoJSON...", matched)
    fc = {
        "type": "FeatureCollection",
        "features": out_features,
    }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(fc, f, separators=(",", ":"), ensure_ascii=False)

    with open(backend_out_path, "w", encoding="utf-8") as f:
        json.dump(fc, f, separators=(",", ":"), ensure_ascii=False)

    size_mb = out_path.stat().st_size / (1024 * 1024)
    logger.info("Wrote %d features to %s and %s (%.2f MB)", len(out_features), out_path, backend_out_path, size_mb)
    return 0


if __name__ == "__main__":
    sys.exit(main())
