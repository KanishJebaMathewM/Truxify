-- =============================================================================
-- Withdrawal settlement: terminal failure after bounded settle retries (Issue #11395)
-- -----------------------------------------------------------------------------
-- Problem:
--   The dispatch-failure path is fail-closed (fail_withdrawal_tx restores
--   funds), but the settle-failure path only logged and left the row at
--   status='pending'. Because the sweep re-selects `status='pending' AND
--   settled_at IS NULL`, an already-dispatched withdrawal whose on-chain settle
--   permanently fails was retried forever, every minute, and never resolved.
--
-- Fix:
--   Track a per-row settle attempt count and, after SETTLE_RETRY_ATTEMPTS
--   failed settle cycles, transition the row to the terminal `settlement_failed`
--   status. `settlement_failed` is excluded by the existing sweep predicate
--   (status='pending'), so the row is no longer retried. Funds are NEVER
--   restored because the payout already left the platform. A one-time terminal
--   alert is emitted by the worker when the row transitions to terminal.
-- =============================================================================

-- 1. Per-row settle attempt counter.
ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS settle_attempts integer NOT NULL DEFAULT 0;

-- 2. Record a settle failure. When p_terminal is true the row is moved to the
--    terminal `settlement_failed` status; otherwise only the error and attempt
--    counter are updated and the row stays retryable. Funds are never restored
--    because the payout was already dispatched. Idempotent: only matches rows
--    still in 'pending', so a terminal row is not re-touched.
CREATE OR REPLACE FUNCTION record_settle_failure(
  p_withdrawal_id uuid,
  p_error text,
  p_terminal boolean
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only the backend service can record settlement failures';
  END IF;

  SELECT driver_id
    INTO v_driver_id
  FROM wallet_transactions
  WHERE id = p_withdrawal_id
    AND txn_type = 'withdrawal'
    AND status = 'pending'
  FOR UPDATE;

  IF v_driver_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_terminal THEN
    UPDATE wallet_transactions
    SET status = 'settlement_failed',
        settlement_error = left(p_error, 1000),
        settle_attempts = settle_attempts + 1
    WHERE id = p_withdrawal_id
      AND txn_type = 'withdrawal'
      AND status = 'pending';
  ELSE
    UPDATE wallet_transactions
    SET settlement_error = left(p_error, 1000),
        settle_attempts = settle_attempts + 1
    WHERE id = p_withdrawal_id
      AND txn_type = 'withdrawal'
      AND status = 'pending';
  END IF;

  RETURN true;
END;
$$;
