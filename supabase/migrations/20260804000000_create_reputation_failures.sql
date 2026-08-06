-- =============================================================================
-- Reputation failure tracking (Issue #6126)
-- -----------------------------------------------------------------------------
-- Problem:
--   orderRepository.insertReputationFailure and reputationReconciliation.js
--   read/write a `reputation_failures` table, but no migration ever created it.
--   On any fresh environment the first insert throws
--   'relation "reputation_failures" does not exist', so failed reputation
--   awards are never persisted for the retry worker.
--
-- Fix:
--   Create the table with the exact columns the repository and reconciliation
--   code insert/filter on (driver_wallet, stars, retry_count, last_error,
--   last_attempt_at, failed_at) and restrict it to the service role.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.reputation_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_wallet text NOT NULL,
  stars integer,
  failed_at timestamptz DEFAULT now(),
  retry_count integer DEFAULT 0,
  last_error text,
  last_attempt_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for efficient polling of retryable failures.
CREATE INDEX IF NOT EXISTS idx_reputation_failures_retry_count
  ON public.reputation_failures (retry_count);

-- Internal table: only the backend (service_role) may access it.
ALTER TABLE public.reputation_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow Service Role full access to reputation_failures"
  ON public.reputation_failures
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
