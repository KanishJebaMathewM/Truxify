-- Migration: Add photo upload support to maintenance tickets
-- Stores up to 3 image URLs per maintenance ticket and creates a private
-- Supabase Storage bucket for the underlying files.

-- Add photo_urls column (TEXT array, defaults to empty)
ALTER TABLE truck_maintenance_tickets
  ADD COLUMN IF NOT EXISTS photo_urls TEXT[] DEFAULT '{}';

-- Private storage bucket for maintenance ticket photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('maintenance-photos', 'maintenance-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Service role: full access to the bucket
DROP POLICY IF EXISTS "Service role full access on maintenance-photos" ON storage.objects;
CREATE POLICY "Service role full access on maintenance-photos"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'maintenance-photos')
  WITH CHECK (bucket_id = 'maintenance-photos');

-- Drivers can read their own maintenance photos
DROP POLICY IF EXISTS "Drivers read own maintenance-photos" ON storage.objects;
CREATE POLICY "Drivers read own maintenance-photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'maintenance-photos'
    AND (storage.foldername(name))[1] = get_profile_id()::text
  );
