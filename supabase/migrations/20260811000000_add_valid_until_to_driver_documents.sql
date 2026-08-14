-- Migration: Add valid_until to driver_documents for expiry tracking.
-- All live upload/verification paths write to driver_documents (not the
-- legacy seed-only `documents` table), so the expiry reminder worker needs
-- the validity date stored here.

ALTER TABLE driver_documents
  ADD COLUMN IF NOT EXISTS valid_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_driver_documents_valid_until
  ON driver_documents (valid_until)
  WHERE valid_until IS NOT NULL;
