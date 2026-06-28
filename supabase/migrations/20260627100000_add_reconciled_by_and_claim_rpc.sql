BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS reconciled_by TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION claim_refund_reconciliation(p_order_id UUID, p_instance_id TEXT)
RETURNS SETOF orders
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE orders
  SET
    escrow_refund_attempts = escrow_refund_attempts + 1,
    escrow_refund_last_attempt_at = NOW(),
    reconciled_by = p_instance_id,
    reconciled_at = NOW()
  WHERE id = p_order_id
    AND escrow_status = 'refund_pending'
    AND reconciled_by IS NULL
  RETURNING *;
END;
$$;

COMMIT;
