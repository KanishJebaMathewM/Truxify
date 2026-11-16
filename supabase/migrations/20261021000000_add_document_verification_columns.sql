-- Migration: align document verification writes with the driver_documents schema
-- The verification service needs OCR metadata, a real expiry column and audit
-- fields. The base table only has storage metadata and a three-value status.

ALTER TABLE driver_documents
  ADD COLUMN IF NOT EXISTS document_number text,
  ADD COLUMN IF NOT EXISTS extracted_data jsonb,
  ADD COLUMN IF NOT EXISTS ocr_confidence numeric(5, 2),
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_notes text;

CREATE INDEX IF NOT EXISTS idx_driver_documents_driver_type
  ON driver_documents (driver_id, document_type);
