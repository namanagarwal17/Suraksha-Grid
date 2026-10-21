-- ============================================================
-- Migration 006: Fix crime_route_intersections RPC
-- Fixes:
--   1. Handle both plain WKT and EWKT input (strip SRID= prefix)
--   2. Guard against invalid stored geometries (GEOS TopologyException)
--   3. Use CTE so ST_Intersection is computed only once per row
--   4. Extract only linear parts from the intersection (ST_CollectionExtract)
--      so point/corner touches correctly yield 0 metres
-- ============================================================

CREATE OR REPLACE FUNCTION crime_route_intersections(
  p_route_wkt      text,             -- WKT or EWKT LineString, SRID 4326
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
  WITH
  -- Parse the route once, stripping any EWKT "SRID=N;" prefix
  route AS (
    SELECT ST_SetSRID(
      ST_GeomFromText(
        regexp_replace(p_route_wkt, '^SRID=\d+;', '', 'i')
      ),
      4326
    ) AS geom
  ),
  -- Pre-filter rows with geometry, then compute intersection
  intersecting AS (
    SELECT
      hce.district,
      hce.state,
      hce.crime_category,
      hce.incident_count,
      hce.year,
      hce.severity_weight,
      hce.source,
      hce.source_dataset,
      -- Extract only linear parts; point-touches collapse to empty → 0 m
      ST_CollectionExtract(
        ST_Intersection(hce.geometry, route.geom),
        2   -- 2 = lines
      ) AS isect_geom
    FROM historical_crime_evidence hce, route
    WHERE
      hce.geometry IS NOT NULL
      -- Skip invalid geometries (avoids GEOS TopologyException)
      AND ST_IsValid(hce.geometry)
      AND ST_Intersects(hce.geometry, route.geom)
  )
  SELECT
    district,
    state,
    crime_category,
    incident_count,
    year,
    severity_weight,
    ST_Length(isect_geom::geography) AS intersection_m,
    source,
    source_dataset
  FROM intersecting
  WHERE ST_Length(isect_geom::geography) >= p_min_length_m
  ORDER BY intersection_m DESC;
$$;

REVOKE ALL ON FUNCTION crime_route_intersections(text, double precision, double precision) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION crime_route_intersections(text, double precision, double precision)
  TO anon, authenticated, service_role;

-- ── Geometry validation helper ─────────────────────────────────────────────
-- Returns count of stored rows with invalid geometries so the join script
-- can report them without crashing route queries.

CREATE OR REPLACE FUNCTION count_invalid_geometries()
RETURNS bigint
LANGUAGE sql
STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT count(*) FROM historical_crime_evidence
  WHERE geometry IS NOT NULL AND NOT ST_IsValid(geometry);
$$;

REVOKE ALL ON FUNCTION count_invalid_geometries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION count_invalid_geometries() TO service_role;

-- ── Unmatched district reporter ────────────────────────────────────────────
-- Returns all distinct (state, district) pairs that still have NULL geometry.

CREATE OR REPLACE FUNCTION list_null_geometry_districts()
RETURNS TABLE(state text, district text, record_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT state, district, count(*) AS record_count
  FROM historical_crime_evidence
  WHERE geometry IS NULL
  GROUP BY state, district
  ORDER BY state, district;
$$;

REVOKE ALL ON FUNCTION list_null_geometry_districts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_null_geometry_districts() TO service_role;
