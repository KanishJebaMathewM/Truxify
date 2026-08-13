-- =============================================================================
-- Wallet withdrawal settlement (Issue #5767)
-- -----------------------------------------------------------------------------
-- Problem:
--   withdraw_funds_tx moves money from wallet_confirmed -> wallet_pending and
--   inserts a 'pending' wallet_transactions row, but nothing ever settles it:
--   there is no payout provider, no settlement worker, and no settlement
--   tracking. Driver money is parked forever and the endpoint reports success
--   for a transfer that never occurs.
--
-- Fix:
--   1. Track settlement outcome on wallet_transactions (settled_at,
--      settlement_ref, settlement_error) and index pending withdrawals for an
--      efficient background sweep.
--   2. Add service-role-only RPCs that settle (complete) a pending withdrawal
--      or fail it and restore the reserved funds to wallet_confirmed so the
--      driver keeps access to the money.
--   3. The withdrawal settlement worker (withdrawalSettlementWorker.js) drives
--      these RPCs through a configured payout provider.
-- =============================================================================

-- 1. Settlement tracking on wallet_transactions.
ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS settlement_ref text,
  ADD COLUMN IF NOT EXISTS settlement_error text;

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_pending_withdrawals
  ON wallet_transactions (created_at)
  WHERE txn_type = 'withdrawal' AND status = 'pending' AND settled_at IS NULL;

-- 2. Settle a pending withdrawal: mark it completed, record the payout
--    reference and release the reserved wallet_pending balance. Idempotent
--    because it only matches rows still in 'pending'.
CREATE OR REPLACE FUNCTION settle_withdrawal_tx(
  p_withdrawal_id uuid,
  p_settlement_ref text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id uuid;
  v_amount int;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only the backend service can settle withdrawals';
  END IF;

  SELECT driver_id, amount
    INTO v_driver_id, v_amount
  FROM wallet_transactions
  WHERE id = p_withdrawal_id
    AND txn_type = 'withdrawal'
    AND status = 'pending'
  FOR UPDATE;

  IF v_driver_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE wallet_transactions
  SET status = 'completed',
      settled_at = now(),
      settlement_ref = p_settlement_ref,
      settlement_error = null
  WHERE id = p_withdrawal_id
    AND txn_type = 'withdrawal'
    AND status = 'pending';

  UPDATE driver_details
  SET wallet_pending = GREATEST(wallet_pending - v_amount, 0),
      updated_at = now()
  WHERE user_id = v_driver_id;

  RETURN true;
END;
$$;

-- 3. Fail a pending withdrawal: mark it failed with the error and restore the
--    reserved funds to wallet_confirmed so the driver keeps access.
CREATE OR REPLACE FUNCTION fail_withdrawal_tx(
  p_withdrawal_id uuid,
  p_error text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id uuid;
  v_amount int;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only the backend service can fail withdrawals';
  END IF;

  SELECT driver_id, amount
    INTO v_driver_id, v_amount
  FROM wallet_transactions
  WHERE id = p_withdrawal_id
    AND txn_type = 'withdrawal'
    AND status = 'pending'
  FOR UPDATE;

  IF v_driver_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE wallet_transactions
  SET status = 'failed',
      settlement_error = p_error
  WHERE id = p_withdrawal_id
    AND txn_type = 'withdrawal'
    AND status = 'pending';

  UPDATE driver_details
  SET wallet_pending = GREATEST(wallet_pending - v_amount, 0),
      wallet_confirmed = wallet_confirmed + v_amount,
      updated_at = now()
  WHERE user_id = v_driver_id;

  RETURN true;
END;
$$;
