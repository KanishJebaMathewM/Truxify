BEGIN;

-- RPC: cancel_order_tx - Cancel an order and initiate escrow refund atomically.
-- Fixes a phantom status check (issue #6979): 'arrived_dropoff' is not a valid
-- order status in this codebase (see orderLifecycleService.js activeStatuses),
-- so the in-transit guard could never match. Mirror the backend cancelOrder
-- flow (fixed in PR #6863) and reject on the real terminal status 'delivered'.
CREATE OR REPLACE FUNCTION cancel_order_tx(
  p_order_id        UUID,
  p_cancellation_reason TEXT,
  p_customer_id     UUID
)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Identity is derived from the JWT. IS DISTINCT FROM fails closed when the
  -- caller has no resolvable profile (get_profile_id() IS NULL).
  IF auth.role() <> 'service_role'
     AND get_profile_id() IS DISTINCT FROM v_order.customer_id THEN
    RAISE EXCEPTION 'Access Denied: You do not own this order.';
  END IF;

  -- Mirror the status guards the backend cancelOrder flow enforces
  -- (orderLifecycleService.js): delivered/released and in-transit orders
  -- (already picked up) cannot be cancelled for a full refund.
  IF v_order.status IN ('delivered', 'payment_released') THEN
    RAISE EXCEPTION 'Order was already delivered or payment released. Cannot cancel.';
  END IF;

  IF v_order.status IN ('picked_up', 'in_transit', 'arriving', 'delivered') THEN
    RAISE EXCEPTION 'Cannot cancel: the shipment has already been picked up and is in transit.';
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

-- SECURITY DEFINER functions bypass RLS, so PUBLIC EXECUTE must be revoked.
REVOKE EXECUTE ON FUNCTION public.cancel_order_tx(UUID, TEXT, UUID) FROM anon, authenticated;

COMMIT;
