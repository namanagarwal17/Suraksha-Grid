"""
Historical Crime Evidence — unit and integration tests.
Run: cd backend && pytest tests/test_crime.py -v

All tests use SYNTHETIC fixtures in tests/fixtures/crime/.
No real NCRB data is ever used in tests.
"""
from __future__ import annotations

import csv
import json
import math
import os
from pathlib import Path
from unittest.mock import MagicMock, AsyncMock

import pytest

FIXTURES = Path(__file__).parent / "fixtures" / "crime"
CSV_FILE  = FIXTURES / "test_crime_data.csv"
JSON_FILE = FIXTURES / "test_crime_data.json"


# ===========================================================
# Normaliser
# ===========================================================

class TestNormaliser:
    def _make(self):
        from app.services.crime.normalizer import Normaliser
        n = Normaliser("TEST", "Test Dataset 2022")
        return n

    def test_maps_csv_headers(self):
        n = self._make()
        n.set_columns(["State","District","Crime Head","Cases Reported","Year"])
        assert "state" in n._col_map
        assert "crime_category" in n._col_map
        assert "incident_count" in n._col_map

    def test_valid_row(self):
        n = self._make()
        n.set_columns(["State","District","Crime Head","Cases Reported","Year"])
        rec, err = n.normalise({"State":"Maharashtra","District":"Pune","Crime Head":"Theft","Cases Reported":"1234","Year":"2022"})
        assert err is None
        assert rec is not None
        assert rec.state == "Maharashtra"
        assert rec.crime_category == "theft"
        assert rec.incident_count == 1234
        assert rec.year == 2022

    def test_missing_state_invalid(self):
        n = self._make()
        n.set_columns(["State","District","Crime Head","Cases Reported","Year"])
        rec, err = n.normalise({"State":"","District":"Pune","Crime Head":"Theft","Cases Reported":"100","Year":"2022"})
        assert rec is None
        assert err is not None

    def test_missing_category_invalid(self):
        n = self._make()
        n.set_columns(["State","District","Crime Head","Cases Reported","Year"])
        rec, err = n.normalise({"State":"Bihar","District":"Patna","Crime Head":"","Cases Reported":"200","Year":"2022"})
        assert rec is None

    def test_invalid_count_invalid(self):
        n = self._make()
        n.set_columns(["State","District","Crime Head","Cases Reported","Year"])
        rec, err = n.normalise({"State":"Raj","District":"J","Crime Head":"Burglary","Cases Reported":"abc","Year":"2022"})
        assert rec is None

    def test_invalid_year_invalid(self):
        n = self._make()
        n.set_columns(["State","District","Crime Head","Cases Reported","Year"])
        rec, err = n.normalise({"State":"X","District":"Y","Crime Head":"Theft","Cases Reported":"10","Year":"1800"})
        assert rec is None

    def test_severity_applied(self):
        n = self._make()
        n.set_columns(["State","District","Crime Head","Cases Reported","Year"])
        rec, _ = n.normalise({"State":"Delhi","District":"Central","Crime Head":"Murder","Cases Reported":"5","Year":"2022"})
        assert rec is not None
        assert rec.severity_weight == 1.0

    def test_unknown_category_default_severity(self):
        from app.services.crime.config import DEFAULT_SEVERITY_WEIGHT
        n = self._make()
        n.set_columns(["State","District","Crime Head","Cases Reported","Year"])
        rec, _ = n.normalise({"State":"X","District":"Y","Crime Head":"Unusual Offence XYZ","Cases Reported":"10","Year":"2022"})
        assert rec is not None
        assert rec.severity_weight == DEFAULT_SEVERITY_WEIGHT

    def test_metadata_preserved(self):
        n = self._make()
        n.set_columns(["State","District","Crime Head","Cases Reported","Year","Extra"])
        rec, _ = n.normalise({"State":"X","District":"Y","Crime Head":"Theft","Cases Reported":"10","Year":"2022","Extra":"val"})
        assert rec is not None
        assert "Extra" in rec.metadata

    def test_json_column_aliases(self):
        n = self._make()
        n.set_columns(["state_name","district_name","crime_category","incident_count","year"])
        rec, err = n.normalise({"state_name":"Delhi","district_name":"South","crime_category":"Robbery","incident_count":50,"year":2021})
        assert err is None
        assert rec is not None


# ===========================================================
# Importer
# ===========================================================

class TestImporter:
    def test_csv_parse(self):
        from app.services.crime.importer import CrimeDataImporter
        imp = CrimeDataImporter("TEST","Fixture 2022")
        records, summary = imp.parse(CSV_FILE)
        # 4 valid rows in fixture (rows with state/category/year/count)
        assert summary.imported >= 4
        assert summary.skipped >= 3   # the invalid rows
        assert summary.total_rows == summary.imported + summary.skipped

    def test_json_parse(self):
        from app.services.crime.importer import CrimeDataImporter
        imp = CrimeDataImporter("TEST","Fixture JSON")
        records, summary = imp.parse(JSON_FILE)
        assert summary.imported == 2
        assert summary.skipped == 0

    def test_missing_file_raises(self):
        from app.services.crime.importer import CrimeDataImporter
        imp = CrimeDataImporter("TEST","X")
        with pytest.raises(FileNotFoundError):
            imp.parse(Path("/no/such/file.csv"))

    def test_year_override(self):
        from app.services.crime.importer import CrimeDataImporter
        # Use JSON file which has "year" column; override should take precedence
        imp = CrimeDataImporter("TEST","X", year_override=2020)
        records, _ = imp.parse(JSON_FILE)
        assert all(r.year == 2020 for r in records)

    def test_import_summary_str(self):
        from app.services.crime.importer import CrimeDataImporter
        imp = CrimeDataImporter("TEST","X")
        _, summary = imp.parse(CSV_FILE)
        s = str(summary)
        assert "imported" in s.lower()


# ===========================================================
# Time decay
# ===========================================================

class TestTimeDecay:
    def test_recent_year_high_weight(self):
        from app.services.crime.evidence import _time_weight
        w = _time_weight(2023, reference_year=2024)
        assert w >= 0.79

    def test_old_data_lower_weight(self):
        from app.services.crime.evidence import _time_weight
        w_new = _time_weight(2023, reference_year=2024)
        w_old = _time_weight(2010, reference_year=2024)
        assert w_old < w_new

    def test_very_old_above_minimum(self):
        from app.services.crime.evidence import _time_weight
        from app.services.crime.config import MIN_TIME_WEIGHT
        w = _time_weight(1990, reference_year=2024)
        assert w >= MIN_TIME_WEIGHT


# ===========================================================
# Evidence aggregation
# ===========================================================

class TestEvidenceAggregation:
    def _ix(self, category="theft", count=500, year=2022, sev=0.4, exp=0.2):
        from app.services.crime.models import CrimeIntersection
        return CrimeIntersection(
            district="Pune", state="Maharashtra",
            crime_category=category, incident_count=count, year=year,
            severity_weight=sev, intersection_m=exp*1000, route_length_m=1000,
            source="TEST", source_dataset="Test 2022",
        )

    def test_unavailable_when_dataset_absent(self):
        from app.services.crime.evidence import aggregate
        ev = aggregate([], dataset_available=False)
        assert ev.evidence_level == "UNAVAILABLE"
        assert ev.score_adjustment == 0.0
        assert not ev.dataset_available

    def test_none_when_no_intersections(self):
        from app.services.crime.evidence import aggregate
        ev = aggregate([], dataset_available=True)
        assert ev.evidence_level == "NONE"
        assert ev.score_adjustment == 0.0

    def test_adjustment_negative(self):
        from app.services.crime.evidence import aggregate
        ixs = [self._ix(count=2000, sev=0.8, exp=0.5) for _ in range(3)]
        ev = aggregate(ixs, dataset_available=True)
        assert ev.score_adjustment <= 0.0

    def test_high_exposure_gives_high_level(self):
        from app.services.crime.evidence import aggregate
        ixs = [self._ix(exp=0.4) for _ in range(3)]
        ev = aggregate(ixs, dataset_available=True)
        assert ev.evidence_level in ("HIGH", "MODERATE")

    def test_categories_populated(self):
        from app.services.crime.evidence import aggregate
        ixs = [self._ix("theft"), self._ix("robbery")]
        ev = aggregate(ixs, dataset_available=True)
        assert "theft" in ev.categories or "robbery" in ev.categories

    def test_disclaimer_present(self):
        from app.services.crime.evidence import aggregate
        from app.services.crime.config import SOURCE_DISCLAIMER
        ev = aggregate([self._ix()], dataset_available=True)
        assert ev.disclaimer == SOURCE_DISCLAIMER

    def test_explanation_not_probability_language(self):
        from app.services.crime.evidence import aggregate
        ev = aggregate([self._ix()], dataset_available=True)
        assert "% safe" not in ev.explanation.lower()


# ===========================================================
# Safety Engine integration
# ===========================================================

class TestSafetyEngineIntegration:
    def test_zero_adjustment_unchanged(self):
        from app.services.safety_engine import calculate_safety_score, SafetyInput, apply_historical_evidence
        inp = SafetyInput(lighting=70, pedestrian_activity=70, emergency_access="Good", reports=[])
        result = calculate_safety_score(inp)
        adjusted = apply_historical_evidence(result, 0.0, "no evidence")
        assert adjusted.safety_score == result.safety_score

    def test_negative_adjustment_lowers_score(self):
        from app.services.safety_engine import calculate_safety_score, SafetyInput, apply_historical_evidence
        inp = SafetyInput(lighting=70, pedestrian_activity=70, emergency_access="Good", reports=[])
        result = calculate_safety_score(inp)
        adjusted = apply_historical_evidence(result, -8.0, "elevated crime exposure")
        assert adjusted.safety_score < result.safety_score

    def test_adjustment_never_below_zero(self):
        from app.services.safety_engine import calculate_safety_score, SafetyInput, apply_historical_evidence
        inp = SafetyInput(lighting=0, pedestrian_activity=0, emergency_access="Limited", reports=[])
        result = calculate_safety_score(inp)
        adjusted = apply_historical_evidence(result, -12.0, "high crime exposure")
        assert adjusted.safety_score >= 0

    def test_fallback_when_unavailable(self):
        from app.services.safety_engine import calculate_safety_score, SafetyInput
        # When dataset is unavailable, score_adjustment is 0 so no change
        inp = SafetyInput(lighting=70, pedestrian_activity=70, emergency_access="Good", reports=[])
        result = calculate_safety_score(inp)
        assert 0 <= result.safety_score <= 100


# ===========================================================
# Config: weights sum
# ===========================================================

class TestWeights:
    def test_evidence_weights_sum_to_1(self):
        from app.services.crime.config import EVIDENCE_WEIGHTS
        total = (
            EVIDENCE_WEIGHTS.density + EVIDENCE_WEIGHTS.severity
            + EVIDENCE_WEIGHTS.exposure + EVIDENCE_WEIGHTS.time_weight
        )
        assert abs(total - 1.0) < 1e-9

# ===========================================================
# District normalization (join_geometry helpers)
# ===========================================================

class TestJoinNormalization:
    """Tests for the name-normalization logic in join_geometry.py."""

    def _normalize(self, s):
        import re
        s = s.lower().strip()
        s = re.sub(r"[&]", "and", s)
        s = re.sub(r"[^a-z0-9 ]", " ", s)
        s = re.sub(r"\s+", " ", s).strip()
        return s

    def test_normalize_strips_ampersand(self):
        # & → "and"; surrounding chars collapse into it (no extra spaces from re.sub)
        result = self._normalize("A&N Islands")
        assert "and" in result and "islands" in result

    def test_normalize_lowercases(self):
        assert self._normalize("Rajasthan") == "rajasthan"

    def test_non_territorial_railway(self):
        from scripts.join_geometry import _is_non_territorial
        assert _is_non_territorial("Mumbai Railway") is True

    def test_non_territorial_grp(self):
        from scripts.join_geometry import _is_non_territorial
        assert _is_non_territorial("GRP Ajmer") is True

    def test_non_territorial_cyber(self):
        from scripts.join_geometry import _is_non_territorial
        assert _is_non_territorial("Cyber Cell") is True

    def test_non_territorial_scrb(self):
        from scripts.join_geometry import _is_non_territorial
        assert _is_non_territorial("SCRB") is True

    def test_territorial_regular_district(self):
        from scripts.join_geometry import _is_non_territorial
        assert _is_non_territorial("Jaipur East") is False
        assert _is_non_territorial("Pune") is False
        assert _is_non_territorial("Bengaluru City") is False

    def test_strip_commr_suffix(self):
        from scripts.join_geometry import _strip_suffixes, _normalize
        assert _strip_suffixes(_normalize("Mumbai Commr")) == "mumbai"

    def test_strip_city_suffix(self):
        from scripts.join_geometry import _strip_suffixes, _normalize
        assert _strip_suffixes(_normalize("Nagpur City")) == "nagpur"

    def test_jaipur_east_alias_resolves(self):
        from scripts.join_geometry import DISTRICT_ALIASES, _normalize
        key = (_normalize("Jaipur East"), _normalize("Rajasthan"))
        assert key in DISTRICT_ALIASES
        assert DISTRICT_ALIASES[key] == "jaipur"

    def test_bengaluru_city_alias(self):
        from scripts.join_geometry import DISTRICT_ALIASES, _normalize
        key = (_normalize("Bengaluru City"), _normalize("Karnataka"))
        assert key in DISTRICT_ALIASES

    def test_match_returns_wkt_for_exact(self):
        from scripts.join_geometry import match_ncrb_to_boundary, _normalize
        # Build a minimal index
        index = {(_normalize("Maharashtra"), _normalize("Pune")): "POLYGON((73 18, 74 18, 74 19, 73 19, 73 18))"}
        wkt, mtype = match_ncrb_to_boundary("Maharashtra", "Pune", index)
        assert wkt is not None
        assert mtype in ("exact", "normalized")

    def test_match_returns_none_for_railway(self):
        from scripts.join_geometry import match_ncrb_to_boundary
        index = {}
        wkt, mtype = match_ncrb_to_boundary("Maharashtra", "Mumbai Railway", index)
        assert wkt is None
        assert mtype == "non_territorial"

    def test_match_returns_unmatched_for_unknown(self):
        from scripts.join_geometry import match_ncrb_to_boundary
        index = {}
        wkt, mtype = match_ncrb_to_boundary("Rajasthan", "Completely Unknown District XYZ", index)
        assert wkt is None
        assert mtype == "unmatched"

    def test_geojson_polygon_to_wkt(self):
        from scripts.join_geometry import _geojson_to_wkt
        geom = {"type": "Polygon", "coordinates": [[[73, 18], [74, 18], [74, 19], [73, 19], [73, 18]]]}
        wkt = _geojson_to_wkt(geom)
        assert wkt is not None
        assert wkt.startswith("POLYGON")

    def test_geojson_multipolygon_to_wkt(self):
        from scripts.join_geometry import _geojson_to_wkt
        geom = {"type": "MultiPolygon",
                "coordinates": [[[[73, 18], [74, 18], [74, 19], [73, 19], [73, 18]]]]}
        wkt = _geojson_to_wkt(geom)
        assert wkt is not None
        assert wkt.startswith("MULTIPOLYGON")

    def test_build_boundary_index_extracts_entries(self):
        from scripts.join_geometry import build_boundary_index
        features = [{
            "type": "Feature",
            "properties": {"state_name": "Rajasthan", "district_name": "Jaipur"},
            "geometry": {"type": "Polygon",
                         "coordinates": [[[75.0, 26.8], [75.2, 26.8], [75.2, 27.0],
                                          [75.0, 27.0], [75.0, 26.8]]]},
        }]
        index = build_boundary_index(features)
        assert len(index) > 0

    def test_build_boundary_index_skips_missing_props(self):
        from scripts.join_geometry import build_boundary_index
        features = [{"type": "Feature", "properties": {}, "geometry": None}]
        index = build_boundary_index(features)
        assert len(index) == 0


# ===========================================================
# Route intersection (mocked DB RPC)
# ===========================================================

class TestRouteIntersection:
    def _make_db(self, rows):
        """Return a mock DB where rpc('crime_route_intersections') returns rows."""
        db = MagicMock()
        rpc_mock = MagicMock()
        rpc_mock.execute.return_value = MagicMock(data=rows)
        db.rpc.return_value = rpc_mock

        # check_dataset_available mock
        count_mock = MagicMock()
        count_mock.execute.return_value = MagicMock(count=len(rows) + 1)
        db.table.return_value.select.return_value.limit.return_value = count_mock
        return db

    @pytest.mark.asyncio
    async def test_positive_intersection_returns_results(self):
        from app.services.crime.spatial import route_crime_intersections
        row = {
            "district": "Jaipur East", "state": "Rajasthan",
            "crime_category": "total_cognizable_ipc_crimes",
            "incident_count": 1200, "year": 2023,
            "severity_weight": 0.4, "intersection_m": 9934.0,
            "source": "NCRB", "source_dataset": "Crime in India 2023",
        }
        db = self._make_db([row])
        results = await route_crime_intersections(db, "LINESTRING(75.05 26.9, 75.15 26.9)", 9900.0)
        assert len(results) == 1
        assert results[0].district == "Jaipur East"
        assert results[0].intersection_m == pytest.approx(9934.0)

    @pytest.mark.asyncio
    async def test_negative_intersection_returns_empty(self):
        from app.services.crime.spatial import route_crime_intersections
        db = self._make_db([])  # RPC returns no rows
        results = await route_crime_intersections(db, "LINESTRING(80.0 20.0, 80.5 20.5)", 70000.0)
        assert results == []

    @pytest.mark.asyncio
    async def test_zero_length_route_returns_empty(self):
        from app.services.crime.spatial import route_crime_intersections
        db = MagicMock()
        results = await route_crime_intersections(db, "LINESTRING(75.0 26.9, 75.0 26.9)", 0.0)
        assert results == []
        db.rpc.assert_not_called()

    @pytest.mark.asyncio
    async def test_rpc_error_returns_empty_not_exception(self):
        from app.services.crime.spatial import route_crime_intersections
        db = MagicMock()
        db.rpc.side_effect = RuntimeError("PostGIS error")
        results = await route_crime_intersections(db, "LINESTRING(75.0 26.9, 75.2 26.9)", 5000.0)
        assert results == []

    @pytest.mark.asyncio
    async def test_exposure_fraction_calculated(self):
        from app.services.crime.spatial import route_crime_intersections
        row = {
            "district": "D", "state": "S", "crime_category": "theft",
            "incident_count": 100, "year": 2023, "severity_weight": 0.4,
            "intersection_m": 500.0, "source": "T", "source_dataset": "T",
        }
        db = self._make_db([row])
        results = await route_crime_intersections(db, "LINESTRING(0 0, 1 0)", 1000.0)
        assert len(results) == 1
        assert results[0].exposure_fraction == pytest.approx(0.5)

    @pytest.mark.asyncio
    async def test_check_dataset_available_true(self):
        from app.services.crime.spatial import check_dataset_available
        db = MagicMock()
        resp_mock = MagicMock(count=42)
        db.table.return_value.select.return_value.limit.return_value.execute.return_value = resp_mock
        assert await check_dataset_available(db) is True

    @pytest.mark.asyncio
    async def test_check_dataset_available_false(self):
        from app.services.crime.spatial import check_dataset_available
        db = MagicMock()
        resp_mock = MagicMock(count=0)
        db.table.return_value.select.return_value.limit.return_value.execute.return_value = resp_mock
        assert await check_dataset_available(db) is False


# ===========================================================
# No-data-does-not-mean-safe
# ===========================================================

class TestNoDataNotSafe:
    """Absence of historical data must not signal 'safe'."""

    def test_none_level_has_nonzero_confidence(self):
        from app.services.crime.evidence import aggregate
        ev = aggregate([], dataset_available=True)
        assert ev.evidence_level == "NONE"
        # Confidence should reflect that the area was checked but not that
        # it is safe; it must be moderate (≥30), not artificially low.
        assert ev.confidence >= 30

    def test_none_adjustment_is_zero_not_positive(self):
        from app.services.crime.evidence import aggregate
        ev = aggregate([], dataset_available=True)
        assert ev.score_adjustment == 0.0

    def test_unavailable_has_zero_adjustment(self):
        from app.services.crime.evidence import aggregate
        ev = aggregate([], dataset_available=False)
        assert ev.score_adjustment == 0.0
        assert not ev.dataset_available

    def test_safety_engine_no_evidence_applies_no_change(self):
        from app.services.safety_engine import calculate_safety_score, SafetyInput, apply_historical_evidence
        inp = SafetyInput(lighting=60, pedestrian_activity=60, emergency_access="Fair", reports=[])
        result = calculate_safety_score(inp)
        unchanged = apply_historical_evidence(result, 0.0, "no evidence")
        assert unchanged.safety_score == result.safety_score

    def test_safety_engine_negative_evidence_always_reduces(self):
        from app.services.safety_engine import calculate_safety_score, SafetyInput, apply_historical_evidence
        inp = SafetyInput(lighting=80, pedestrian_activity=80, emergency_access="Good", reports=[])
        result = calculate_safety_score(inp)
        adjusted = apply_historical_evidence(result, -5.0, "moderate crime exposure")
        assert adjusted.safety_score <= result.safety_score

    def test_explanation_mentions_historical_evidence(self):
        from app.services.safety_engine import calculate_safety_score, SafetyInput, apply_historical_evidence
        inp = SafetyInput(lighting=70, pedestrian_activity=70, emergency_access="Good", reports=[])
        result = calculate_safety_score(inp)
        adjusted = apply_historical_evidence(result, -7.0, "HIGH crime evidence: theft, robbery")
        assert "historical" in adjusted.explanation.lower()

    def test_score_never_below_zero_with_evidence(self):
        from app.services.safety_engine import calculate_safety_score, SafetyInput, apply_historical_evidence
        inp = SafetyInput(lighting=0, pedestrian_activity=0, emergency_access="Limited", reports=[])
        result = calculate_safety_score(inp)
        adjusted = apply_historical_evidence(result, -12.0, "very high crime exposure")
        assert adjusted.safety_score >= 0


# ===========================================================
# NCRB combined dataset parsing
# ===========================================================

class TestNCRBCombinedDataset:
    """Parse the actual ncrb_2023_combined.csv to verify it loads correctly."""

    CSV_PATH = Path(__file__).parent.parent.parent / "data" / "crime" / "ncrb_2023_combined.csv"

    @pytest.mark.skipif(
        not (Path(__file__).parent.parent.parent / "data" / "crime" / "ncrb_2023_combined.csv").exists(),
        reason="Combined NCRB dataset not present"
    )
    def test_combined_dataset_parses_3780_records(self):
        from app.services.crime.importer import CrimeDataImporter
        imp = CrimeDataImporter("NCRB", "Crime in India 2023")
        records, summary = imp.parse(self.CSV_PATH)
        assert summary.total_rows == 3780
        # Allow minor skips (0-count rows are valid and kept)
        assert summary.imported >= 3700
        assert summary.skipped < 100

    @pytest.mark.skipif(
        not (Path(__file__).parent.parent.parent / "data" / "crime" / "ncrb_2023_combined.csv").exists(),
        reason="Combined NCRB dataset not present"
    )
    def test_combined_dataset_all_year_2023(self):
        from app.services.crime.importer import CrimeDataImporter
        imp = CrimeDataImporter("NCRB", "Crime in India 2023")
        records, _ = imp.parse(self.CSV_PATH)
        assert all(r.year == 2023 for r in records)

    @pytest.mark.skipif(
        not (Path(__file__).parent.parent.parent / "data" / "crime" / "ncrb_2023_combined.csv").exists(),
        reason="Combined NCRB dataset not present"
    )
    def test_jaipur_split_districts_present(self):
        from app.services.crime.importer import CrimeDataImporter
        imp = CrimeDataImporter("NCRB", "Crime in India 2023")
        records, _ = imp.parse(self.CSV_PATH)
        rajasthan = {r.district for r in records if r.state == "Rajasthan"}
        expected = {"Jaipur East", "Jaipur West", "Jaipur North", "Jaipur South",
                    "Jaipur Rural", "Jaipur Metro", "Jaipur Crime"}
        assert len(expected & rajasthan) > 0, "Expected Jaipur sub-districts not found"
        assert "Jaipur" not in rajasthan, "'Jaipur' (plain) should NOT appear — NCRB uses sub-districts"

    def test_crime_geojson_endpoint(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.api.v1.crime import clear_crime_geojson_cache

        clear_crime_geojson_cache()
        client = TestClient(app)
        resp = client.get("/api/v1/crime/geojson")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("type") == "FeatureCollection"
        assert "features" in data
        assert len(data["features"]) == 614
        f0 = data["features"][0]
        assert "properties" in f0
        assert "district" in f0["properties"]
        assert "total_incidents" in f0["properties"]
        assert f0["properties"]["year"] == 2023
        assert f0["properties"]["source"] == "NCRB"
        assert "geometry" in f0

    def test_crime_geojson_missing_file_honest_503(self, monkeypatch):
        from fastapi.testclient import TestClient
        from app.main import app
        import app.api.v1.crime as crime_mod

        crime_mod.clear_crime_geojson_cache()
        monkeypatch.setattr(crime_mod, "resolve_crime_geojson_path", lambda: None)

        client = TestClient(app)
        resp = client.get("/api/v1/crime/geojson")
        assert resp.status_code == 503
        data = resp.json()
        assert "detail" in data
        assert "unavailable" in data["detail"].lower()
        crime_mod.clear_crime_geojson_cache()

    def test_crime_geojson_empty_features_file_honest_500(self, tmp_path, monkeypatch):
        from fastapi.testclient import TestClient
        from app.main import app
        import app.api.v1.crime as crime_mod

        empty_file = tmp_path / "empty_districts.json"
        empty_file.write_text(json.dumps({"type": "FeatureCollection", "features": []}), encoding="utf-8")

        crime_mod.clear_crime_geojson_cache()
        monkeypatch.setattr(crime_mod, "resolve_crime_geojson_path", lambda: empty_file)

        client = TestClient(app)
        resp = client.get("/api/v1/crime/geojson")
        assert resp.status_code == 500
        data = resp.json()
        assert "detail" in data
        crime_mod.clear_crime_geojson_cache()

    def test_backend_bundle_packaging_includes_processed_geojson(self):
        """Verify the processed GeoJSON file is bundled inside backend/data/crime/processed/."""
        backend_file = Path(__file__).resolve().parent.parent / "data" / "crime" / "processed" / "ncrb_districts_geojson.json"
        assert backend_file.exists(), f"Backend deployment file missing: {backend_file}"
        assert backend_file.stat().st_size > 1_000_000, "GeoJSON file unexpectedly small"

        with open(backend_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert data.get("type") == "FeatureCollection"
        assert len(data.get("features", [])) == 614
