-- ============================================================
-- Suraksha Grid — Migration 002: Row Level Security
-- Run order: 2 (after 001_initial_schema)
-- ============================================================

-- ============================================================
-- profiles
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read only their own profile
CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can update only their own profile
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Users can insert only their own profile (in case trigger was bypassed)
CREATE POLICY "profiles_insert_own"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- ============================================================
-- road_segments  (public read, no user writes via client)
-- ============================================================
ALTER TABLE road_segments ENABLE ROW LEVEL SECURITY;

-- Anyone (including anonymous) can read segments
CREATE POLICY "road_segments_public_read"
  ON road_segments FOR SELECT
  USING (true);

-- Only service-role (FastAPI backend) can insert/update/delete.
-- Regular authenticated users cannot modify segments from the client.

-- ============================================================
-- routes  (public read, service-role write)
-- ============================================================
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "routes_public_read"
  ON routes FOR SELECT
  USING (true);

-- ============================================================
-- safety_reports
-- ============================================================
ALTER TABLE safety_reports ENABLE ROW LEVEL SECURITY;

-- Authenticated users can create reports
CREATE POLICY "safety_reports_insert_auth"
  ON safety_reports FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Authenticated users can read all non-dismissed reports
CREATE POLICY "safety_reports_select_public"
  ON safety_reports FOR SELECT
  USING (status != 'dismissed');

-- Users can update only their own pending/reviewed reports
CREATE POLICY "safety_reports_update_own"
  ON safety_reports FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id AND status IN ('pending','reviewed'))
  WITH CHECK (auth.uid() = user_id);

-- Users can delete only their own reports
CREATE POLICY "safety_reports_delete_own"
  ON safety_reports FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- street_stories
-- ============================================================
ALTER TABLE street_stories ENABLE ROW LEVEL SECURITY;

-- Anyone can read stories
CREATE POLICY "street_stories_public_read"
  ON street_stories FOR SELECT
  USING (true);

-- Authenticated users can create stories as themselves
CREATE POLICY "street_stories_insert_auth"
  ON street_stories FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update/delete only their own stories
CREATE POLICY "street_stories_update_own"
  ON street_stories FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "street_stories_delete_own"
  ON street_stories FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- help_points  (public read, service-role write)
-- ============================================================
ALTER TABLE help_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "help_points_public_read"
  ON help_points FOR SELECT
  USING (true);

-- ============================================================
-- saved_routes  (private per-user)
-- ============================================================
ALTER TABLE saved_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_routes_select_own"
  ON saved_routes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "saved_routes_insert_own"
  ON saved_routes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "saved_routes_delete_own"
  ON saved_routes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
