-- ============================================================
-- Suraksha Grid — Demo seed data
-- PURPOSE: synthetic/demo data only; safe to re-run
-- NOTE: run this in Supabase SQL Editor as database owner/admin.
--       Do NOT run through the browser/anon client.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Stable UUIDs keep this seed idempotent.
-- ------------------------------------------------------------

-- ROAD SEGMENTS
INSERT INTO road_segments
  (id, geometry, name, safety_score, confidence_score,
   lighting_score, pedestrian_activity_score, emergency_access_score,
   emergency_access_label, time_condition, explanation, recent_reports_count)
VALUES
('00000000-0000-0000-0000-00000000000a',
 ST_GeomFromText('LINESTRING(77.0290 28.4280,77.0560 28.4280)', 4326),
 'Ring Road', 82, 90, 88, 80, 92, 'Good',
 'Consistently lit through the evening',
 'Well-lit main road with steady traffic and a help point nearby.', 0),

('00000000-0000-0000-0000-00000000000b',
 ST_GeomFromText('LINESTRING(77.0560 28.4280,77.0560 28.4595)', 4326),
 'MG Road', 71, 82, 68, 74, 88, 'Good',
 'Dims noticeably after 9 PM',
 'Generally active, with a dim stretch near the flyover.', 1),

('00000000-0000-0000-0000-00000000000c',
 ST_GeomFromText('LINESTRING(77.0560 28.4595,77.0830 28.4595)', 4326),
 'Market Lane', 44, 76, 35, 30, 35, 'Limited',
 'Quiet and poorly lit after 9 PM',
 'Quiet after 9 PM, patchy lighting and a construction detour.', 3),

('00000000-0000-0000-0000-00000000000d',
 ST_GeomFromText('LINESTRING(77.0830 28.4595,77.0920 28.4595)', 4326),
 'Station Link', 58, 70, 55, 60, 62, 'Fair',
 'Crowded during evening train hours',
 'Short link that gets crowded around train times.', 2),

('00000000-0000-0000-0000-00000000000e',
 ST_GeomFromText('LINESTRING(77.0560 28.4280,77.0920 28.4280)', 4326),
 'Canal Road', 86, 88, 90, 78, 95, 'Good',
 'Patrolled through the night',
 'Wide, lit road with regular patrol observations and open shops.', 0),

('00000000-0000-0000-0000-00000000000f',
 ST_GeomFromText('LINESTRING(77.0920 28.4280,77.0920 28.4595)', 4326),
 'Temple Street', 79, 84, 80, 82, 86, 'Good',
 'Lively until around 10 PM',
 'Busy with pedestrians and small shops until late.', 1),

('00000000-0000-0000-0000-000000000010',
 ST_GeomFromText('LINESTRING(77.0920 28.4595,77.0965 28.4820)', 4326),
 'Civil Lines', 81, 86, 84, 70, 90, 'Good',
 'Steady lighting overnight',
 'Residential road, well lit and close to emergency facilities.', 0),

('00000000-0000-0000-0000-000000000011',
 ST_GeomFromText('LINESTRING(77.0290 28.4280,77.0290 28.4820,77.0965 28.4820)', 4326),
 'Garden Path', 91, 92, 94, 85, 94, 'Good',
 'Busy with walkers into the night',
 'Longest option but consistently lit and active with nearby help access.', 0)
ON CONFLICT (id) DO UPDATE SET
  geometry = EXCLUDED.geometry,
  name = EXCLUDED.name,
  safety_score = EXCLUDED.safety_score,
  confidence_score = EXCLUDED.confidence_score,
  lighting_score = EXCLUDED.lighting_score,
  pedestrian_activity_score = EXCLUDED.pedestrian_activity_score,
  emergency_access_score = EXCLUDED.emergency_access_score,
  emergency_access_label = EXCLUDED.emergency_access_label,
  time_condition = EXCLUDED.time_condition,
  explanation = EXCLUDED.explanation,
  recent_reports_count = EXCLUDED.recent_reports_count,
  updated_at = now();

-- ROUTES
INSERT INTO routes
  (id, name, route_type, distance_m, duration_s, safety_score, confidence,
   reason, segment_ids, geometry, recommended)
VALUES
('10000000-0000-0000-0000-000000000001',
 'Fastest', 'fastest', 3100, 840, 58, 76,
 'Shortest path, but passes a quiet, poorly lit lane.',
 ARRAY[
   '00000000-0000-0000-0000-00000000000a'::uuid,
   '00000000-0000-0000-0000-00000000000b'::uuid,
   '00000000-0000-0000-0000-00000000000c'::uuid,
   '00000000-0000-0000-0000-00000000000d'::uuid,
   '00000000-0000-0000-0000-000000000010'::uuid
 ],
 ST_GeomFromText('LINESTRING(77.0290 28.4280,77.0560 28.4280,77.0560 28.4595,77.0830 28.4595,77.0920 28.4595,77.0965 28.4820)', 4326),
 false),

('10000000-0000-0000-0000-000000000002',
 'Balanced', 'balanced', 3600, 1020, 81, 88,
 'Only a few minutes slower, while staying on lit, active roads.',
 ARRAY[
   '00000000-0000-0000-0000-00000000000a'::uuid,
   '00000000-0000-0000-0000-00000000000e'::uuid,
   '00000000-0000-0000-0000-00000000000f'::uuid,
   '00000000-0000-0000-0000-000000000010'::uuid
 ],
 ST_GeomFromText('LINESTRING(77.0290 28.4280,77.0560 28.4280,77.0920 28.4280,77.0920 28.4595,77.0965 28.4820)', 4326),
 true),

('10000000-0000-0000-0000-000000000003',
 'Safest', 'safest', 4800, 1440, 91, 92,
 'Best lit and most active option, with help access along the way.',
 ARRAY['00000000-0000-0000-0000-000000000011'::uuid],
 ST_GeomFromText('LINESTRING(77.0290 28.4280,77.0290 28.4820,77.0965 28.4820)', 4326),
 false)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  route_type = EXCLUDED.route_type,
  distance_m = EXCLUDED.distance_m,
  duration_s = EXCLUDED.duration_s,
  safety_score = EXCLUDED.safety_score,
  confidence = EXCLUDED.confidence,
  reason = EXCLUDED.reason,
  segment_ids = EXCLUDED.segment_ids,
  geometry = EXCLUDED.geometry,
  recommended = EXCLUDED.recommended;

-- HELP POINTS
INSERT INTO help_points
  (id, name, type, latitude, longitude, address, phone, open_24h)
VALUES
('40000000-0000-0000-0000-000000000001', 'Sector 14 Police Station', 'police', 28.4370, 77.0470, 'Sector 14, Demo Area', '112', true),
('40000000-0000-0000-0000-000000000002', 'Medanta Hospital', 'hospital', 28.4685, 77.0938, 'Demo medical district', '102', true),
('40000000-0000-0000-0000-000000000003', 'Canal Road Help Point', 'help', 28.4280, 77.0740, 'Canal Road, Demo Area', null, true),
('40000000-0000-0000-0000-000000000004', 'Civil Hospital Emergency', 'hospital', 28.4730, 77.0695, 'Civil Lines, Demo Area', '102', true),
('40000000-0000-0000-0000-000000000005', 'Police Booth, Temple Street', 'police', 28.4505, 77.0920, 'Temple Street, Demo Area', '112', false)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  address = EXCLUDED.address,
  phone = EXCLUDED.phone,
  open_24h = EXCLUDED.open_24h;

-- SYNTHETIC COMMUNITY REPORTS
INSERT INTO safety_reports
  (id, user_id, road_segment_id, description, category, severity, latitude, longitude, status)
VALUES
('20000000-0000-0000-0000-000000000001', NULL, '00000000-0000-0000-0000-00000000000c', 'Two streetlights appear to be out.', 'Poor lighting', 3, 28.4595, 77.0695, 'reviewed'),
('20000000-0000-0000-0000-000000000002', NULL, '00000000-0000-0000-0000-00000000000c', 'Construction has narrowed the walking path.', 'Construction', 2, 28.4595, 77.0785, 'pending'),
('20000000-0000-0000-0000-000000000003', NULL, '00000000-0000-0000-0000-00000000000c', 'Quiet stretch with very little pedestrian activity after 9 PM.', 'Isolated', 3, 28.4595, 77.0810, 'reviewed'),
('20000000-0000-0000-0000-00000000000b', NULL, '00000000-0000-0000-0000-00000000000b', 'Dim lighting reported near the flyover.', 'Poor lighting', 2, 28.4500, 77.0560, 'pending'),
('20000000-0000-0000-0000-00000000000d', NULL, '00000000-0000-0000-0000-00000000000d', 'Crowded during evening train hours.', 'Crowded', 1, 28.4595, 77.0880, 'reviewed'),
('20000000-0000-0000-0000-00000000000f', NULL, '00000000-0000-0000-0000-00000000000f', 'Evening police presence observed nearby.', 'Police presence', 1, 28.4470, 77.0920, 'reviewed'),
('20000000-0000-0000-0000-000000000007', NULL, NULL, 'Demo positive safety observation: active shops and steady foot traffic.', 'Police presence', 1, 28.4450, 77.0800, 'reviewed')
ON CONFLICT (id) DO UPDATE SET
  road_segment_id = EXCLUDED.road_segment_id,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  severity = EXCLUDED.severity,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  status = EXCLUDED.status;

-- SYNTHETIC STREET STORIES
INSERT INTO street_stories
  (id, user_id, road_segment_id, place_name, content, tags, helpful_count)
VALUES
('30000000-0000-0000-0000-000000000001', NULL, '00000000-0000-0000-0000-00000000000c',
 'Market Lane',
 'Two streetlights have been out this week. I would choose Canal Road after dark.',
 ARRAY['Poor lighting','Isolated'], 18),
('30000000-0000-0000-0000-000000000002', NULL, '00000000-0000-0000-0000-00000000000e',
 'Canal Road',
 'Shops were still open in the evening and the road felt active.',
 ARRAY['Police presence'], 31),
('30000000-0000-0000-0000-000000000003', NULL, '00000000-0000-0000-0000-00000000000d',
 'Station Link',
 'Very crowded around the evening train window. Keep belongings secure.',
 ARRAY['Crowded'], 9),
('30000000-0000-0000-0000-000000000004', NULL, '00000000-0000-0000-0000-00000000000b',
 'MG Road',
 'Construction narrows the pavement near the flyover.',
 ARRAY['Construction'], 6)
ON CONFLICT (id) DO UPDATE SET
  road_segment_id = EXCLUDED.road_segment_id,
  place_name = EXCLUDED.place_name,
  content = EXCLUDED.content,
  tags = EXCLUDED.tags,
  helpful_count = EXCLUDED.helpful_count,
  updated_at = now();

COMMIT;

-- ------------------------------------------------------------
-- Verification queries (run separately if desired)
-- ------------------------------------------------------------
-- SELECT count(*) AS road_segments FROM road_segments;
-- SELECT count(*) AS routes FROM routes;
-- SELECT count(*) AS help_points FROM help_points;
-- SELECT count(*) AS safety_reports FROM safety_reports;
-- SELECT count(*) AS street_stories FROM street_stories;
-- SELECT id, name, ST_GeometryType(geometry) AS geometry_type, ST_IsValid(geometry) AS valid FROM road_segments ORDER BY name;
