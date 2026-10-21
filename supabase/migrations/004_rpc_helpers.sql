-- ============================================================
-- Suraksha Grid — Migration 004: RPC helper functions
-- Run order: 4 (after 003_realtime)
-- ============================================================

-- ----------------------------------------------------------------
-- increment_helpful
-- Safe atomic increment of street_stories.helpful_count.
-- Only authenticated users may call this; the function checks that
-- the story exists before updating so orphan calls are no-ops.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_helpful(story_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER   -- runs as the calling user → subject to RLS
AS $$
BEGIN
  UPDATE street_stories
  SET    helpful_count = helpful_count + 1,
         updated_at    = now()
  WHERE  id = story_id;
  -- No error on missing row — idempotent
END;
$$;

-- Only authenticated users may execute this function.
REVOKE ALL ON FUNCTION increment_helpful(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION increment_helpful(uuid) TO authenticated;


-- ----------------------------------------------------------------
-- increment_report_count
-- Safe atomic increment of road_segments.recent_reports_count.
-- Called by the FastAPI backend (service-role) after a report is
-- inserted, so the RLS bypass is appropriate here.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_report_count(seg_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER                  -- needs to bypass RLS to update segments
SET search_path = public, pg_temp -- harden against search_path injection
AS $$
BEGIN
  UPDATE road_segments
  SET    recent_reports_count = recent_reports_count + 1,
         updated_at           = now()
  WHERE  id = seg_id;
END;
$$;

-- Only the FastAPI service-role may call this; anon/authenticated cannot.
REVOKE ALL  ON FUNCTION increment_report_count(uuid) FROM PUBLIC;
REVOKE ALL  ON FUNCTION increment_report_count(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION increment_report_count(uuid) TO service_role;


-- ----------------------------------------------------------------
-- upsert_segment_scores
-- Called by the FastAPI safety engine after recalculation.
-- Atomically writes new scores and an updated explanation back to
-- the road_segments table and notifies the Realtime channel.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION upsert_segment_scores(
  p_segment_id          uuid,
  p_safety_score        smallint,
  p_confidence_score    smallint,
  p_lighting_score      smallint,
  p_pedestrian_activity smallint,
  p_explanation         text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE road_segments
  SET
    safety_score              = p_safety_score,
    confidence_score          = p_confidence_score,
    lighting_score            = p_lighting_score,
    pedestrian_activity_score = p_pedestrian_activity,
    explanation               = p_explanation,
    updated_at                = now()
  WHERE id = p_segment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Segment % not found', p_segment_id;
  END IF;
END;
$$;

REVOKE ALL  ON FUNCTION upsert_segment_scores(uuid,smallint,smallint,smallint,smallint,text) FROM PUBLIC;
REVOKE ALL  ON FUNCTION upsert_segment_scores(uuid,smallint,smallint,smallint,smallint,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION upsert_segment_scores(uuid,smallint,smallint,smallint,smallint,text) TO service_role;
