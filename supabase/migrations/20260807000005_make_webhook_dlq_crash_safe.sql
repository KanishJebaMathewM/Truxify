-- Migration: Make webhook DLQ processing crash-safe with lease-based claims
-- ----------------------------------------------------------------------------
-- Root cause fixed:
--   20260710000000 created webhook_failures with
--     CHECK (status IN ('pending', 'failed_permanently', 'resolved'))
--   while dlqService.js attempts `pending -> processing`. The CHECK constraint
--   therefore rejected every claim UPDATE and the DLQ worker could never retry
--   anything — events were stranded in 'pending' forever.
--
-- This migration:
--   1. Adds `processing` to the status CHECK (pending -> processing -> resolved,
--      processing -> pending (retry), processing -> failed_permanently).
--   2. Adds lease/ownership columns (claimed_by, claimed_at, lease_expires_at)
--      so a processing row is owned for a finite time and can be reclaimed by
--      any replica after the lease expires (crash recovery).
--   3. Adds `attempt_count` (total claims, incl. reclaims) to bound crash loops,
--      plus `resolved_at` for completion metadata.
--   4. Adds `dedupe_key` with a unique partial index so duplicate provider
--      deliveries cannot create two DLQ rows (idempotent enqueue).
--   5. Adds a service_role-only SECURITY DEFINER RPC,
--      `claim_webhook_failure_batch`, that atomically claims pending-due and
--      lease-expired rows with SELECT ... FOR UPDATE SKIP LOCKED so multiple
--      API replicas can never claim the same row.
--
-- Non-destructive: existing rows and statuses remain valid; no table rewritten.
-- ----------------------------------------------------------------------------

-- ─── 1. Allow the processing lifecycle ───────────────────────────────────────
ALTER TABLE webhook_failures DROP CONSTRAINT IF EXISTS webhook_failures_status_check;
ALTER TABLE webhook_failures
  ADD CONSTRAINT webhook_failures_status_check
  CHECK (status IN ('pending', 'processing', 'failed_permanently', 'resolved'));

-- ─── 2. Lease / ownership / idempotency columns ─────────────────────────────
ALTER TABLE webhook_failures
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dedupe_key text;

-- ─── 3. Indexes for efficient worker polling ────────────────────────────────
-- Pending-due polling (existing): status = 'pending' AND next_retry_at <= now().
-- Lease-expiry reclaim polling:   status = 'processing' AND lease_expires_at < now().
CREATE INDEX IF NOT EXISTS idx_webhook_failures_processing_lease
  ON webhook_failures (status, lease_expires_at)
  WHERE status = 'processing';

-- Deduplicate duplicate provider deliveries at enqueue time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_failures_dedupe_key
  ON webhook_failures (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- ─── 4. Atomic batch claim RPC ──────────────────────────────────────────────
-- Claims up to p_batch_size eligible rows in a single statement:
--   - pending rows whose next_retry_at is due, and
--   - processing rows whose lease has expired (crashed workers).
-- SELECT ... FOR UPDATE SKIP LOCKED guarantees that concurrent replicas can
-- never claim the same row: each row is locked at most once.
CREATE OR REPLACE FUNCTION claim_webhook_failure_batch(
  p_worker_id TEXT,
  p_batch_size INT DEFAULT 10,
  p_lease_seconds INT DEFAULT 300,
  p_max_attempts INT DEFAULT 25
)
RETURNS SETOF webhook_failures
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only the backend service can claim webhook failure rows';
  END IF;

  -- Crash-loop guard: a processing row whose lease expired too many times is a
  -- crash casualty, not a retryable failure. Escalate instead of reclaiming
  -- forever (prevents a worker that always crashes mid-flight from spinning).
  UPDATE webhook_failures
  SET status = 'failed_permanently',
      error_message = coalesce(error_message, 'Lease expired too many times without completion'),
      updated_at = v_now
  WHERE status = 'processing'
    AND lease_expires_at < v_now
    AND attempt_count >= p_max_attempts;

  RETURN QUERY
  WITH eligible AS (
    SELECT id
    FROM webhook_failures
    WHERE (status = 'pending' AND next_retry_at <= v_now)
       OR (status = 'processing' AND lease_expires_at < v_now)
    ORDER BY next_retry_at ASC, id ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE webhook_failures wf
  SET status = 'processing',
      claimed_by = p_worker_id,
      claimed_at = v_now,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      attempt_count = wf.attempt_count + 1,
      updated_at = v_now
  FROM eligible e
  WHERE wf.id = e.id
  RETURNING wf.*;
END;
$$;

-- Functions are PUBLIC-executable by default; restrict to the backend like the
-- other reconciliation claim RPCs so anonymous users cannot drive the DLQ.
REVOKE ALL ON FUNCTION claim_webhook_failure_batch(text, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_webhook_failure_batch(text, integer, integer, integer) TO service_role;
