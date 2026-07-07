-- Migration: Create driver_documents table and storage bucket
-- Stores KYC document metadata (Aadhaar, PAN, licence, RC book, etc.)
-- uploaded by drivers. The actual file bytes live in Supabase Storage;
-- this table tracks who uploaded what, its verified content type, and
-- review status.

CREATE TABLE IF NOT EXISTS driver_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  document_type  text NOT NULL,
  storage_path   text NOT NULL,
  mime_type      text NOT NULL,
  status         text NOT NULL DEFAULT 'pending_review'
                 CHECK (status IN ('pending_review', 'approved', 'rejected')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_documents_driver_id ON driver_documents (driver_id);

ALTER TABLE driver_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on driver_documents" ON driver_documents;
CREATE POLICY "Service role full access on driver_documents"
  ON driver_documents FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers read own driver_documents" ON driver_documents;
CREATE POLICY "Drivers read own driver_documents"
  ON driver_documents FOR SELECT TO authenticated
  USING (driver_id = get_profile_id());

DROP TRIGGER IF EXISTS trg_driver_documents_updated_at ON driver_documents;
CREATE TRIGGER trg_driver_documents_updated_at
  BEFORE UPDATE ON driver_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Private storage bucket for the underlying files. Not publicly readable;
-- only the backend (service role) and the owning driver can access their
-- own files, matching the driver_documents RLS policy above.
INSERT INTO storage.buckets (id, name, public)
VALUES ('driver-documents', 'driver-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Service role full access on driver-documents storage" ON storage.objects;
CREATE POLICY "Service role full access on driver-documents storage"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'driver-documents')
  WITH CHECK (bucket_id = 'driver-documents');

DROP POLICY IF EXISTS "Drivers read own files in driver-documents storage" ON storage.objects;
CREATE POLICY "Drivers read own files in driver-documents storage"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'driver-documents'
    AND (storage.foldername(name))[1] = get_profile_id()::text
  );
