-- ============================================================
-- Suraksha Grid — Migration 001: Initial schema
-- Run order: 1
-- ============================================================

-- Enable PostGIS for spatial queries
CREATE EXTENSION IF NOT EXISTS postgis;
-- Generate UUIDs without requiring uuid-ossp
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_id_idx ON profiles(id);

-- Automatically create a profile row when a new auth user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles(id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- road_segments
-- ============================================================
CREATE TABLE IF NOT EXISTS road_segments (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- PostGIS LineString, SRID 4326 (WGS-84 lon/lat)
  geometry                  geometry(LineString, 4326) NOT NULL,
  name                      text NOT NULL,
  safety_score              smallint NOT NULL CHECK (safety_score BETWEEN 0 AND 100),
  confidence_score          smallint NOT NULL DEFAULT 70 CHECK (confidence_score BETWEEN 0 AND 100),
  lighting_score            smallint NOT NULL DEFAULT 50 CHECK (lighting_score BETWEEN 0 AND 100),
  pedestrian_activity_score smallint NOT NULL DEFAULT 50 CHECK (pedestrian_activity_score BETWEEN 0 AND 100),
  emergency_access_score    smallint NOT NULL DEFAULT 50 CHECK (emergency_access_score BETWEEN 0 AND 100),
  emergency_access_label    text NOT NULL DEFAULT 'Fair' CHECK (emergency_access_label IN ('Good','Fair','Limited')),
  time_condition            text,
  explanation               text,
  recent_reports_count      int NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS road_segments_geom_idx
  ON road_segments USING GIST(geometry);

CREATE TRIGGER road_segments_updated_at
  BEFORE UPDATE ON road_segments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- routes
-- ============================================================
CREATE TABLE IF NOT EXISTS routes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  -- 'fastest' | 'balanced' | 'safest'
  route_type   text NOT NULL CHECK (route_type IN ('fastest','balanced','safest')),
  distance_m   int NOT NULL,
  duration_s   int NOT NULL,
  safety_score smallint NOT NULL CHECK (safety_score BETWEEN 0 AND 100),
  confidence   smallint NOT NULL DEFAULT 70,
  reason       text,
  -- Ordered array of road_segment IDs that make up this route
  segment_ids  uuid[] NOT NULL DEFAULT '{}',
  -- Full LineString geometry for rendering
  geometry     geometry(LineString, 4326),
  recommended  boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS routes_route_type_idx ON routes(route_type);
CREATE INDEX IF NOT EXISTS routes_geom_idx ON routes USING GIST(geometry) WHERE geometry IS NOT NULL;

-- ============================================================
-- safety_reports
-- ============================================================
CREATE TABLE IF NOT EXISTS safety_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  road_segment_id   uuid REFERENCES road_segments(id) ON DELETE SET NULL,
  description       text,
  -- matches REPORT_TAGS in src/lib/constants.ts
  category          text NOT NULL,
  severity          smallint NOT NULL DEFAULT 1 CHECK (severity BETWEEN 1 AND 5),
  latitude          double precision NOT NULL,
  longitude         double precision NOT NULL,
  -- 'pending' | 'reviewed' | 'actioned' | 'dismissed'
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','actioned','dismissed')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS safety_reports_user_id_idx  ON safety_reports(user_id);
CREATE INDEX IF NOT EXISTS safety_reports_segment_idx  ON safety_reports(road_segment_id);
CREATE INDEX IF NOT EXISTS safety_reports_created_idx  ON safety_reports(created_at DESC);
-- Spatial index on lat/lon (point-in-box queries)
CREATE INDEX IF NOT EXISTS safety_reports_geo_idx
  ON safety_reports USING GIST(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326));

-- ============================================================
-- street_stories
-- ============================================================
CREATE TABLE IF NOT EXISTS street_stories (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  road_segment_id   uuid REFERENCES road_segments(id) ON DELETE SET NULL,
  place_name        text,
  content           text NOT NULL,
  tags              text[] NOT NULL DEFAULT '{}',
  helpful_count     int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS street_stories_user_id_idx ON street_stories(user_id);
CREATE INDEX IF NOT EXISTS street_stories_segment_idx ON street_stories(road_segment_id);
CREATE INDEX IF NOT EXISTS street_stories_created_idx ON street_stories(created_at DESC);

CREATE TRIGGER street_stories_updated_at
  BEFORE UPDATE ON street_stories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- help_points
-- ============================================================
CREATE TABLE IF NOT EXISTS help_points (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  -- 'police' | 'hospital' | 'help'
  type        text NOT NULL CHECK (type IN ('police','hospital','help')),
  latitude    double precision NOT NULL,
  longitude   double precision NOT NULL,
  address     text,
  phone       text,
  open_24h    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS help_points_geo_idx
  ON help_points USING GIST(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326));

-- ============================================================
-- saved_routes
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_routes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  route_id   uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  label      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, route_id)
);

CREATE INDEX IF NOT EXISTS saved_routes_user_id_idx ON saved_routes(user_id);
