-- ============================================================
-- Suraksha Grid — Migration 003: Supabase Realtime publication
-- Run order: 3 (after 002_rls)
-- ============================================================

-- Supabase uses a special publication to control which tables are
-- replicated to connected clients via the Realtime WebSocket.

-- Add safety_reports so the frontend receives INSERT events
-- (used in Phase 3 subscription architecture, score updates in Phase 4).
ALTER PUBLICATION supabase_realtime ADD TABLE safety_reports;

-- Add road_segments so clients receive score-update PATCH events
-- emitted by the FastAPI backend after report processing (Phase 4).
ALTER PUBLICATION supabase_realtime ADD TABLE road_segments;
