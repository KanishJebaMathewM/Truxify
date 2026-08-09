-- =============================================================================
-- Migration: Reject non-positive withdraw amounts + harden wallet (Issue #5723)
-- =============================================================================
-- Problem:
--   withdraw_funds_tx only guards `v_confirmed < p_amount`. With a negative
--   p_amount (e.g. -100000) the balance check always passes and
--   `wallet_confirmed = v_confirmed - p_amount` ADDS |p_amount| to the
--   confirmed balance while driving wallet_pending negative. wallet_* columns
--   have no CHECK constraints, so the negative wallet_pending never errors and
--   a driver can mint unlimited wallet_confirmed via direct REST RPC calls.
--
-- Fix:
--   1. Reject NULL / non-positive amounts at the top of the RPC.
--   2. Enforce a per-driver per-day withdrawal cap inside the RPC.
--   3. Add CHECK (wallet_confirmed >= 0) and CHECK (wallet_pending >= 0) so a
--      minted/negative balance is impossible at the database level.
--   4. Revoke UPDATE on wallet_* columns from anon/authenticated so clients
--      cannot PATCH driver_details.wallet_confirmed directly.
-- =============================================================================

-- 1. Wallet balance columns must never go negative.
--    NOT VALID + VALIDATE avoids failing if legacy data already violates it.
ALTER TABLE driver_details
  ADD CONSTRAINT driver_details_wallet_confirmed_nonnegative
  CHECK (wallet_confirmed >= 0) NOT VALID;

ALTER TABLE driver_details
  ADD CONSTRAINT driver_details_wallet_pending_nonnegative
  CHECK (wallet_pending >= 0) NOT VALID;

ALTER TABLE driver_details
  VALIDATE CONSTRAINT driver_details_wallet_confirmed_nonnegative;

ALTER TABLE driver_details
  VALIDATE CONSTRAINT driver_details_wallet_pending_nonnegative;

-- 2. Harden withdraw_funds_tx: positive-amount guard + daily withdrawal cap.
CREATE OR REPLACE FUNCTION withdraw_funds_tx(
  p_driver_id   UUID,
  p_amount      INT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_confirmed  INT;
  v_pending    INT;
  v_day_total  INT;
  v_daily_cap  CONSTANT INT := 10000000;  -- ₹1,00,000 in paisa per UTC calendar day
BEGIN
  -- Verify the caller IS the driver.
  -- auth.uid() is the Firebase UID; get_profile_id() maps it to profiles.id
  -- which is what p_driver_id stores, so compare via get_profile_id().
  IF auth.uid() IS NOT NULL AND get_profile_id() <> p_driver_id THEN
    RAISE EXCEPTION 'Unauthorized: you can only withdraw your own funds';
  END IF;

  -- Reject non-positive amounts: a negative p_amount would otherwise mint
  -- wallet_confirmed via wallet_confirmed = v_confirmed - p_amount.
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be a positive whole number of paisa';
  END IF;

  -- Enforce the per-driver per-day withdrawal cap.
  -- Only count withdrawals that actually left the wallet; failed withdrawals
  -- have their amount restored to wallet_confirmed and must not consume cap.
  SELECT COALESCE(SUM(amount), 0)
    INTO v_day_total
    FROM wallet_transactions
   WHERE driver_id  = p_driver_id
     AND txn_type   = 'withdrawal'
     AND status    <> 'failed'
     AND created_at >= date_trunc('day', now());

  IF v_day_total + p_amount > v_daily_cap THEN
    RAISE EXCEPTION 'Daily withdrawal cap exceeded: % of % used',
      v_day_total + p_amount, v_daily_cap;
  END IF;

  -- Lock the wallet row to prevent concurrent withdrawals.
  SELECT wallet_confirmed, wallet_pending
    INTO v_confirmed, v_pending
    FROM driver_details
   WHERE user_id = p_driver_id
     FOR UPDATE;

  IF v_confirmed IS NULL OR v_confirmed < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance: available %, requested %',
      COALESCE(v_confirmed, 0), p_amount;
  END IF;

  -- Move funds from confirmed → pending.
  UPDATE driver_details
     SET wallet_confirmed = v_confirmed - p_amount,
         wallet_pending   = v_pending   + p_amount,
         updated_at       = now()
   WHERE user_id = p_driver_id;

  -- Log the withdrawal transaction.
  INSERT INTO wallet_transactions
    (driver_id, amount, txn_type, status, description)
  VALUES
    (p_driver_id, p_amount, 'withdrawal', 'pending',
     'Withdrawal to registered bank account');
END;
$$;

-- 3. Only the backend (service_role) may write wallet balance columns.
--    This blocks direct PATCH /rest/v1/driver_details with wallet_* fields.
REVOKE UPDATE (wallet_confirmed, wallet_pending, wallet_total)
  ON driver_details FROM anon, authenticated;
