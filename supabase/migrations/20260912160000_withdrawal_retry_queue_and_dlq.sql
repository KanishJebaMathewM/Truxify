-- =============================================================================
-- Withdrawal Retry Queue, Exponential Backoff, DLQ & Admin Operations
-- =============================================================================

-- 1. Add retry scheduling and DLQ metadata columns to wallet_transactions
ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS max_retries integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS dlq_at timestamptz,
  ADD COLUMN IF NOT EXISTS dlq_reason text;

-- 2. Partial index for efficient polling of pending retries
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_retry_queue
  ON wallet_transactions (next_retry_at, created_at)
  WHERE txn_type = 'withdrawal' AND status = 'pending' AND settled_at IS NULL;

-- 3. Partial index for DLQ and stuck transactions inspection
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_dlq
  ON wallet_transactions (dlq_at)
  WHERE txn_type = 'withdrawal' AND (status = 'settlement_failed' OR status = 'dlq');

-- 4. RPC to schedule an automatic withdrawal retry with exponential backoff
CREATE OR REPLACE FUNCTION schedule_withdrawal_retry(
  p_withdrawal_id uuid,
  p_error text,
  p_delay_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id uuid;
  v_current_retries integer;
  v_max_retries integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only the backend service can schedule withdrawal retries';
  END IF;

  SELECT driver_id, retry_count, max_retries
    INTO v_driver_id, v_current_retries, v_max_retries
  FROM wallet_transactions
  WHERE id = p_withdrawal_id
    AND txn_type = 'withdrawal'
    AND status = 'pending'
  FOR UPDATE;

  IF v_driver_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE wallet_transactions
  SET retry_count = retry_count + 1,
      settlement_error = left(p_error, 1000),
      next_retry_at = now() + (GREATEST(p_delay_seconds, 1) || ' seconds')::interval,
      payout_attempted_at = NULL -- Reset claim so subsequent attempt can re-claim cleanly
  WHERE id = p_withdrawal_id
    AND txn_type = 'withdrawal'
    AND status = 'pending';

  RETURN true;
END;
$$;

-- 5. RPC to move a withdrawal to Dead-Letter Queue (DLQ)
CREATE OR REPLACE FUNCTION move_withdrawal_to_dlq(
  p_withdrawal_id uuid,
  p_reason text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only the backend service can move withdrawals to DLQ';
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

  UPDATE wallet_transactions
  SET status = 'settlement_failed',
      settlement_error = left(p_reason, 1000),
      dlq_at = now(),
      dlq_reason = left(p_reason, 1000)
  WHERE id = p_withdrawal_id
    AND txn_type = 'withdrawal'
    AND status = 'pending';

  RETURN true;
END;
$$;

-- 6. RPC for admin dashboard reconciliation: manual retry or force refund
CREATE OR REPLACE FUNCTION admin_resolve_dlq_withdrawal(
  p_withdrawal_id uuid,
  p_action text,
  p_admin_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id uuid;
  v_amount numeric;
  v_current_status text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only authorized administrators can resolve DLQ withdrawals';
  END IF;

  SELECT driver_id, amount, status
    INTO v_driver_id, v_amount, v_current_status
  FROM wallet_transactions
  WHERE id = p_withdrawal_id
    AND txn_type = 'withdrawal'
  FOR UPDATE;

  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Withdrawal transaction not found');
  END IF;

  IF p_action = 'retry' THEN
    IF EXISTS (
      SELECT 1 FROM wallet_transactions
      WHERE id = p_withdrawal_id
        AND (payout_attempted_at IS NOT NULL OR settlement_ref IS NOT NULL)
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot retry a withdrawal after payout dispatch was attempted');
    END IF;

    -- Reset to pending, clear attempt & error, schedule immediate retry
    UPDATE wallet_transactions
    SET status = 'pending',
        retry_count = 0,
        settle_attempts = 0,
        payout_attempted_at = NULL,
        settlement_ref = NULL,
        settlement_error = NULL,
        dlq_at = NULL,
        dlq_reason = NULL,
        next_retry_at = now()
    WHERE id = p_withdrawal_id;

    RETURN jsonb_build_object('success', true, 'action', 'retried', 'status', 'pending');

  ELSIF p_action = 'refund' THEN
    -- Safely restore reserved funds to wallet_confirmed and mark failed
    IF v_current_status = 'completed' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot refund an already completed withdrawal');
    END IF;

    UPDATE wallet_transactions
    SET status = 'failed',
        settlement_error = COALESCE(p_notes, 'Admin force-refunded stuck withdrawal'),
        settled_at = now(),
        dlq_reason = COALESCE(p_notes, 'Refunded by administrator')
    WHERE id = p_withdrawal_id;

    UPDATE driver_details
    SET wallet_pending = GREATEST(wallet_pending - v_amount, 0),
        wallet_confirmed = wallet_confirmed + v_amount,
        updated_at = now()
    WHERE user_id = v_driver_id;

    RETURN jsonb_build_object('success', true, 'action', 'refunded', 'status', 'failed');

  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Invalid action: must be retry or refund');
  END IF;
END;
$$;
