-- Migration: fix fraud table schema mismatches introduced by the duplicate
-- 20260804101500_create_fraud_tables.sql migration.
--
-- The earlier migration (20260804101500) ran first and its schema won because
-- both migrations used CREATE TABLE IF NOT EXISTS. This left the tables with
-- the wrong schema:
--   • behavioral_profiles.last_activity is bigint — the service writes an ISO
--     timestamp string, which Postgres rejects with "invalid input syntax for
--     type bigint".
--   • fraud_review_queue is missing action, notes, resolved_at, updated_at —
--     columns the service writes in resolveReview(), so every resolve/dismiss
--     call fails at runtime.
--
-- This migration brings the live schema into line with what FraudDetectionService
-- actually reads and writes, without dropping and re-creating the tables (which
-- would lose any data already written and break the RLS policies applied by the
-- subsequent hardening migrations).

-- Fix behavioral_profiles.last_activity: bigint → timestamptz
ALTER TABLE behavioral_profiles
  ALTER COLUMN last_activity TYPE timestamptz
  USING CASE
    WHEN last_activity IS NULL THEN NULL
    ELSE to_timestamp(last_activity / 1000.0)  -- treat existing bigint as epoch-ms
  END;

-- Add missing columns to fraud_review_queue
ALTER TABLE fraud_review_queue
  ADD COLUMN IF NOT EXISTS action      text,
  ADD COLUMN IF NOT EXISTS notes       text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

-- Drop columns that exist in the old schema but not the canonical one,
-- so the table matches 20260805000040 exactly.
ALTER TABLE fraud_review_queue
  DROP COLUMN IF EXISTS reviewed_by,
  DROP COLUMN IF EXISTS reviewed_at;
