-- =============================================================================
-- Fix: admin_resolve_dlq_withdrawal was not state-aware, allowing a
--       double-refund of a driver's reserved funds and a phantom "pending"
--       resurrection of an already-settled withdrawal.
--
-- Defects in 20260912160000_withdrawal_retry_queue_and_dlq.sql:
--
--   1. DOUBLE REFUND (money loss). The refund branch rejected only
--      `status = 'completed'` but then *wrote* `status = 'failed'`. Because
--      'failed' <> 'completed', calling the refund action a second time
--      passed the guard and re-ran the balance transfer, crediting
--      `wallet_confirmed + v_amount` to the driver a second time. Nothing
--      stopped the repeat: the refund path ignores `settled_at`, and the
--      admin route has no idempotency middleware.
--
--   2. BALANCE INFLATION ON A SINGLE CALL. The debit side was floored
--      (`GREATEST(wallet_pending - v_amount, 0)`) while the credit side added
--      the full `v_amount`. When `wallet_pending < v_amount` the driver gained
--      `v_amount - wallet_pending` out of nothing.
--
--   3. RETRY ON A SETTLED ROW (state integrity). The retry branch had no status
--      guard at all, so it flipped `completed` and `failed` rows back to
--      `pending`. `settled_at` was deliberately left set so the settlement
--      worker (which filters on `settled_at IS NULL`) still skipped the row —
--      that safety net is preserved here — but the row is left as a phantom
--      `pending` withdrawal that neither settles nor fails, corrupting every
--      `status`-based reconciliation.
--
-- The sibling RPCs from the same migration (`schedule_withdrawal_retry` and
-- `move_withdrawal_to_dlq`) already scoped both their SELECT and their UPDATE
-- to `status = 'pending'`, which made a repeat call a no-op. This function was
-- the only one missing that discipline, so the fix restores it here: both
-- actions are now restricted to the genuinely refundable/retryable states, and
-- the refund is idempotent.
-- =============================================================================

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
  v_pending_balance numeric;
  v_refundable numeric;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only authorized administrators can resolve DLQ withdrawals';
  END IF;

  -- Lock the withdrawal for the whole transaction so two concurrent admin
  -- calls cannot both observe a refundable state. FOR UPDATE alone does not
  -- help against *sequential* double calls, which is what the status guards
  -- below take care of.
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
    -- A settled or already-refunded withdrawal must never be re-queued.
    IF v_current_status = 'completed' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot retry an already completed withdrawal');
    END IF;

    IF v_current_status = 'failed' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot retry a refunded withdrawal; it has already been settled back to the driver');
    END IF;

    -- Reset to pending, clear attempt & error, schedule immediate retry.
    -- `settled_at` is intentionally left untouched: it is the settlement
    -- worker's guard against re-paying an already-dispatched payout.
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
    -- The money has already left the driver's hands.
    IF v_current_status = 'completed' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot refund an already completed withdrawal');
    END IF;

    -- Already refunded by an earlier call. This is the double-refund guard:
    -- a refund writes status = 'failed', so without this branch a repeat call
    -- would credit the driver again.
    IF v_current_status = 'failed' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Withdrawal has already been refunded'
      );
    END IF;

    -- Determine how much is actually still reserved, and refund only that.
    -- Flooring the debit at 0 while crediting the full amount would create
    -- money out of nothing whenever wallet_pending < amount.
    SELECT COALESCE(dd.wallet_pending, 0)
      INTO v_pending_balance
    FROM driver_details dd
    WHERE dd.user_id = v_driver_id
    FOR UPDATE;

    v_refundable := GREATEST(LEAST(v_amount, COALESCE(v_pending_balance, 0)), 0);

    -- Mark the payout as failed regardless of whether funds remained reserved.
    UPDATE wallet_transactions
    SET status = 'failed',
        settlement_error = COALESCE(p_notes, 'Admin force-refunded stuck withdrawal'),
        settled_at = now(),
        dlq_reason = COALESCE(p_notes, 'Refunded by administrator')
    WHERE id = p_withdrawal_id;

    -- Move back exactly what was debited from the reserved balance; never more.
    UPDATE driver_details
    SET wallet_pending = wallet_pending - v_refundable,
        wallet_confirmed = wallet_confirmed + v_refundable,
        updated_at = now()
    WHERE user_id = v_driver_id;

    RETURN jsonb_build_object(
      'success', true,
      'action', 'refunded',
      'status', 'failed',
      'refunded_amount', v_refundable
    );

  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Invalid action: must be retry or refund');
  END IF;
END;
$$;
