BEGIN;

-- Issue #14694: make escrowRefundReconciliation claim->finalize crash-safe.
--
-- The previous version of claim_refund_reconciliation only claimed a row when
-- reconciled_by IS NULL. If the worker crashed between claiming and finalizing
-- (the long on-chain refund confirmation window), reconciled_by stayed set to
-- the instance id and the order was frozen in refund_pending forever — even on
-- the same host after a restart, because the instance id (HOSTNAME) is
-- unchanged and a non-null reconciled_by was treated as permanently owned.
--
-- This re-defines the RPC to also re-acquire a claim whose lease has expired
-- (reconciled_at older than p_lease_seconds), so a crashed-in-flight order is
-- eventually reclaimed and the refund can complete. A *fresh* claim (lease not
-- yet expired) is still respected, so two live instances never double-process.

CREATE OR REPLACE FUNCTION claim_refund_reconciliation(
  p_order_id UUID,
  p_instance_id TEXT,
  p_lease_seconds INT DEFAULT 900
)
RETURNS SETOF orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only the backend service can claim refund reconciliation rows';
  END IF;

  RETURN QUERY
  UPDATE orders
  SET
    escrow_refund_attempts = escrow_refund_attempts + 1,
    escrow_refund_last_attempt_at = NOW(),
    reconciled_by = p_instance_id,
    reconciled_at = NOW()
  WHERE id = p_order_id
    AND escrow_status IN ('refund_pending', 'refund_failed')
    AND (
      reconciled_by IS NULL
      OR (
        reconciled_by IS NOT NULL
        AND reconciled_at IS NOT NULL
        AND reconciled_at < NOW() - (p_lease_seconds || ' seconds')::INTERVAL
      )
    )
  RETURNING *;
END;
$$;

COMMIT;
