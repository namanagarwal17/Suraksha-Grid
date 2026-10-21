-- ============================================================
-- Suraksha Grid — Migration 005: Historical Crime Evidence
-- Run order: 5 (after 004_rpc_helpers)
-- ============================================================

-- ── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS historical_crime_evidence (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  state           text          NOT NULL,
  district        text          NOT NULL,
  crime_category  text          NOT NULL,
  incident_count  int           NOT NULL CHECK (incident_count >= 0),
  year            smallint      NOT NULL CHECK (year > 1900 AND year < 2100),
  source          text          NOT NULL,          -- e.g. "NCRB"
  source_dataset  text          NOT NULL,          -- e.g. "Crime in India 2023"
  severity_weight numeric(4,3)  NOT NULL DEFAULT 0.3 CHECK (severity_weight BETWEEN 0 AND 1),
  -- PostGIS geometry — either a Point (if source has coordinates) or
  -- a Polygon / MultiPolygon (after district boundary join).
  -- NULL is valid when no geometry is available for this record.
  geometry        geometry(Geometry, 4326),
  metadata        jsonb         NOT NULL DEFAULT '{}',
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Spatial index (the primary index for route intersection queries)
CREATE INDEX IF NOT EXISTS hce_geom_idx
  ON historical_crime_evidence USING GIST(geometry)
  WHERE geometry IS NOT NULL;

-- Analytical indexes
CREATE INDEX IF NOT EXISTS hce_state_district_idx
  ON historical_crime_evidence(state, district);

CREATE INDEX IF NOT EXISTS hce_category_idx
  ON historical_crime_evidence(crime_category);

CREATE INDEX IF NOT EXISTS hce_year_idx
  ON historical_crime_evidence(year DESC);

CREATE INDEX IF NOT EXISTS hce_source_idx
  ON historical_crime_evidence(source, source_dataset);

-- ── Auto-update updated_at ────────────────────────────────────────────────────

CREATE TRIGGER hce_updated_at
  BEFORE UPDATE ON historical_crime_evidence
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();  -- defined in migration 001

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE historical_crime_evidence ENABLE ROW LEVEL SECURITY;

-- Public read (aggregated, non-identifiable historical data)
CREATE POLICY "hce_public_read"
  ON historical_crime_evidence FOR SELECT
  USING (true);

-- Only service-role (FastAPI importer) may write
-- No INSERT/UPDATE/DELETE policy for authenticated or anon roles.

-- ── PostGIS RPC: route intersection query ─────────────────────────────────────

CREATE OR REPLACE FUNCTION crime_route_intersections(
  p_route_wkt      text,        -- WKT LineString, SRID 4326
  p_route_length_m double precision,
  p_min_length_m   double precision DEFAULT 50.0
)
RETURNS TABLE (
  district        text,
  state           text,
  crime_category  text,
  incident_count  int,
  year            smallint,
  severity_weight numeric,
  intersection_m  double precision,
  source          text,
  source_dataset  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    hce.district,
    hce.state,
    hce.crime_category,
    hce.incident_count,
    hce.year,
    hce.severity_weight,
    -- Convert degrees → approximate metres (1° ≈ 111,320 m at equator)
    ST_Length(
      ST_Intersection(
        hce.geometry,
        ST_GeomFromText(p_route_wkt, 4326)
      )::geography
    ) AS intersection_m,
    hce.source,
    hce.source_dataset
  FROM historical_crime_evidence hce
  WHERE
    hce.geometry IS NOT NULL
    AND ST_Intersects(
          hce.geometry,
          ST_GeomFromText(p_route_wkt, 4326)
        )
    AND ST_Length(
          ST_Intersection(
            hce.geometry,
            ST_GeomFromText(p_route_wkt, 4326)
          )::geography
        ) >= p_min_length_m
  ORDER BY intersection_m DESC;
$$;

REVOKE ALL ON FUNCTION crime_route_intersections(text, double precision, double precision) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION crime_route_intersections(text, double precision, double precision) TO anon, authenticated, service_role;


-- ── Geometry join helper ──────────────────────────────────────────────────────
-- Called by the join_geometry script (migration 005 also prepares the update path)

CREATE OR REPLACE FUNCTION attach_district_geometry(
  p_state     text,
  p_district  text,
  p_geometry  geometry(Geometry, 4326)
)
RETURNS int           -- number of rows updated
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  updated int;
BEGIN
  UPDATE historical_crime_evidence
  SET    geometry  = p_geometry,
         updated_at= now()
  WHERE  lower(state)    = lower(p_state)
    AND  lower(district) = lower(p_district)
    AND  geometry IS NULL;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END;
$$;

REVOKE ALL ON FUNCTION attach_district_geometry(text, text, geometry(Geometry,4326)) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION attach_district_geometry(text, text, geometry(Geometry,4326)) TO service_role;
