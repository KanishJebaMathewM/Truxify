BEGIN;

CREATE OR REPLACE FUNCTION claim_release_reconciliation(p_order_id UUID, p_instance_id TEXT)
RETURNS SETOF orders
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE orders
  SET
    escrow_release_attempts = escrow_release_attempts + 1,
    escrow_release_last_attempt_at = NOW(),
    reconciled_by = p_instance_id,
    reconciled_at = NOW()
  WHERE id = p_order_id
    AND escrow_status = 'release_failed'
    AND reconciled_by IS NULL
  RETURNING *;
END;
$$;

COMMIT;
