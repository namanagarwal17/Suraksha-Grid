-- ============================================================
-- Suraksha Grid — Migration 006: Report image upload support
-- Run order: 6 (after 005_historical_crime_evidence)
-- ============================================================

-- Add image_url column to safety_reports
ALTER TABLE safety_reports
  ADD COLUMN IF NOT EXISTS image_url text;

-- Add vision analysis columns (non-scoring, informational only)
ALTER TABLE safety_reports
  ADD COLUMN IF NOT EXISTS vision_lighting       text,
  ADD COLUMN IF NOT EXISTS vision_obstruction    text,
  ADD COLUMN IF NOT EXISTS vision_crowd_activity text,
  ADD COLUMN IF NOT EXISTS vision_summary        text,
  ADD COLUMN IF NOT EXISTS vision_confidence     text;

-- ============================================================
-- Storage bucket: report-images
-- ============================================================
-- Creates a private bucket. Files are accessible via signed URLs
-- or via the service role key in the backend.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'report-images',
  'report-images',
  false,                                           -- not publicly listable
  5242880,                                         -- 5 MB per file
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Storage RLS policies
-- ============================================================

-- Authenticated users can upload into their own folder: <user_id>/<filename>
CREATE POLICY "report_images_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'report-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authenticated users can read their own uploaded files
CREATE POLICY "report_images_select_own"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'report-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authenticated users can delete their own files
CREATE POLICY "report_images_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'report-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
