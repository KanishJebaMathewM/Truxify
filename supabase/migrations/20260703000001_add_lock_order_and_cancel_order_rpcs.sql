BEGIN;

-- RPC: lock_order_for_update — Row-level lock on an order to serialize
-- concurrent verify-delivery and cancel requests on the same order.
CREATE OR REPLACE FUNCTION lock_order_for_update(p_order_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM 1 FROM orders WHERE id = p_order_id FOR UPDATE;
END;
$$;

-- RPC: cancel_order_tx — Cancel an order and initiate escrow refund atomically.
-- Combines the status update and escrow_status transition in a single
-- transaction with row-level locking, preventing race conditions.
CREATE OR REPLACE FUNCTION cancel_order_tx(
  p_order_id        UUID,
  p_cancellation_reason TEXT,
  p_customer_id     UUID
)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.customer_id <> p_customer_id THEN
    RAISE EXCEPTION 'Access Denied: You do not own this order.';
  END IF;

  IF v_order.status IN ('delivered', 'payment_released') THEN
    RAISE EXCEPTION 'Order was already delivered or payment released. Cannot cancel.';
  END IF;

  IF v_order.escrow_status NOT IN ('funded', 'refund_pending', 'refund_failed') THEN
    RAISE EXCEPTION 'Order escrow status does not allow cancellation.';
  END IF;

  UPDATE orders
  SET
    status = 'cancelled',
    cancellation_reason = COALESCE(p_cancellation_reason, v_order.cancellation_reason),
    escrow_status = 'refund_pending',
    escrow_refund_error = NULL,
    escrow_refund_attempts = COALESCE(v_order.escrow_refund_attempts, 0) + 1,
    escrow_refund_last_attempt_at = NOW(),
    updated_at = NOW()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  RETURN v_order;
END;
$$;

COMMIT;
