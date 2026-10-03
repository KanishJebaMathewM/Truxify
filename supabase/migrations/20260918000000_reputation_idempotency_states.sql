-- =============================================================================
-- Migration: Add Durable Idempotency & State Tracking to Reputation Failures
-- =============================================================================

ALTER TABLE public.reputation_failures
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS tx_hash text,
  ADD COLUMN IF NOT EXISTS award_key text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- Add index on status and retry_count for efficient reconciliation queries
CREATE INDEX IF NOT EXISTS idx_reputation_failures_status_retry
  ON public.reputation_failures (status, retry_count);

-- Add index on award_key for fast idempotency lookups
CREATE INDEX IF NOT EXISTS idx_reputation_failures_award_key
  ON public.reputation_failures (award_key);

-- Add index on tx_hash for tracking submitted transactions
CREATE INDEX IF NOT EXISTS idx_reputation_failures_tx_hash
  ON public.reputation_failures (tx_hash);
