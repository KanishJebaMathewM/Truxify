-- Guard fail_withdrawal_tx against refunding a withdrawal whose payout already
-- succeeded.
--
-- fail_withdrawal_tx moves a pending withdrawal to 'failed' and restores the
-- reserved balance to wallet_confirmed. That restore is only correct when no
-- money actually left the platform.
--
-- dispatchPayout records a settlement_ref on the row once the provider confirms
-- the payout. A recorded settlement_ref is therefore positive evidence that the
-- payout was accepted - not merely that we failed to learn about it. Refunding a
-- row that carries one pays the driver twice: once at the gateway, once back into
-- the wallet.
--
-- This is defense in depth at the money boundary. The worker's error classifier
-- (isAmbiguousDispatchError) is what decides between retry and refund, and it is a
-- heuristic over provider responses, so it cannot be the only thing standing
-- between a misclassification and a double credit.
--
-- The worker's legitimate fast-fail path is unaffected: it calls this RPC only
-- when dispatchPayout threw before the provider responded, so settlement_ref is
-- NULL and the guard passes.
--
-- Both the locking SELECT and the UPDATE re-assert the predicate so eligibility
-- cannot change between them.

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
  v_amount numeric;
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
    AND settlement_ref IS NULL
  FOR UPDATE;

  IF v_driver_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE wallet_transactions
  SET status = 'failed',
      settlement_error = p_error
  WHERE id = p_withdrawal_id
    AND txn_type = 'withdrawal'
    AND status = 'pending'
    AND settlement_ref IS NULL;

  UPDATE driver_details
  SET wallet_pending = GREATEST(wallet_pending - v_amount, 0),
      wallet_confirmed = wallet_confirmed + v_amount,
      updated_at = now()
  WHERE user_id = v_driver_id;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION fail_withdrawal_tx(uuid, text) IS
  'Marks a pending withdrawal failed and restores reserved funds. Refuses (returns false) when a settlement_ref is recorded, since that proves the payout was accepted and refunding would pay the driver twice.';