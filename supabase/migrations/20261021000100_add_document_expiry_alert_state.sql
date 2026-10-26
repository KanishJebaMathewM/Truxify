-- Migration: add the alert state used by the document expiry job.
-- The job queried alert_sent_*_days, last_alert_sent_at and expiry_date, none
-- of which exist; driver_documents stores the expiry in valid_until and uses
-- the 'approved' status.

ALTER TABLE driver_documents
  ADD COLUMN IF NOT EXISTS document_number text,
  ADD COLUMN IF NOT EXISTS alert_sent_30_days boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alert_sent_7_days boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alert_sent_1_days boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_alert_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_driver_documents_expiry_alerts
  ON driver_documents (valid_until, status);
