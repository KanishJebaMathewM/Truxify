-- Migration: Create reputation_failures table
-- Backs the on-chain reputation retry queue. awardReputationPoints failures
-- are persisted here and retried by reputationReconciliation.

CREATE TABLE IF NOT EXISTS reputation_failures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_wallet   text NOT NULL,
  stars           numeric NOT NULL DEFAULT 0,
  failed_at       timestamptz NOT NULL DEFAULT now(),
  retry_count     integer NOT NULL DEFAULT 0,
  last_error      text,
  last_attempt_at timestamptz
);

CREATE INDEX IF NOT EXISTS reputation_failures_retry_idx
  ON reputation_failures (retry_count);
