-- =============================================================================
-- Migration: withdraw_funds_tx daily cap must exclude failed withdrawals
-- (Issue #10677)
-- =============================================================================
-- Problem:
--   20260805120001_fix_rpc_ownership_checks.sql rewrote withdraw_funds_tx to
--   use the get_profile_id() ownership check but, in doing so, dropped the
--   `status <> 'failed'` exclusion (added by #6298/#6271) from the daily-cap
--   query. The cap now sums every withdrawal for the UTC day regardless of
--   outcome. A payout that is later failed by fail_withdrawal_tx restores its
--   amount to wallet_confirmed, yet the failed transaction still consumes the
--   driver's ₹1,00,000 daily cap and can permanently block legitimate
--   withdrawals that never left the wallet.
--
-- Fix:
--   Redefine withdraw_funds_tx to exclude failed withdrawals from the
--   per-driver per-day cap sum, restoring the pre-regression behaviour while
--   keeping the get_profile_id() ownership guard, the positive-amount guard
--   and the row-lock serialization of the cap decision.
-- =============================================================================

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
  -- Verify the caller IS the driver. get_profile_id() maps the Firebase JWT
  -- sub to profiles.id, which is what p_driver_id/req.user.id actually store
  -- (auth.uid() is the Firebase UID and would never match). Null-safe: an
  -- unauthenticated caller (auth.uid() IS NULL) must also be rejected, not
  -- just skipped.
  IF auth.uid() IS NULL OR get_profile_id() <> p_driver_id THEN
    RAISE EXCEPTION 'Unauthorized: you can only withdraw your own funds';
  END IF;

  -- Reject non-positive amounts: a negative p_amount would otherwise mint
  -- wallet_confirmed via wallet_confirmed = v_confirmed - p_amount.
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be a positive whole number of paisa';
  END IF;

  -- Lock the wallet row first so the daily cap decision and the balance
  -- movement are serialized: two concurrent withdrawals from the same driver
  -- cannot both read the same v_day_total and both pass the cap check.
  SELECT wallet_confirmed, wallet_pending
    INTO v_confirmed, v_pending
    FROM driver_details
   WHERE user_id = p_driver_id
     FOR UPDATE;

  -- Enforce the per-driver per-day withdrawal cap under the row lock.
  -- Only count withdrawals that actually left the wallet: failed withdrawals
  -- have their amount restored to wallet_confirmed by fail_withdrawal_tx and
  -- must not consume the cap (restores the #6298/#6271 exclusion that
  -- 20260805120001_fix_rpc_ownership_checks.sql dropped).
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

-- Function creation grants EXECUTE to PUBLIC by default (callable with the
-- public anon key). Revoke it and allow only authenticated sessions so the
-- ownership guard above is the only gate for real users.
REVOKE EXECUTE ON FUNCTION withdraw_funds_tx(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION withdraw_funds_tx(UUID, INT) TO authenticated;
