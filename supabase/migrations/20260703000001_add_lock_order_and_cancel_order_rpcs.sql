BEGIN;

-- RPC: lock_order_for_update — Row-level lock on an order to serialize
-- concurrent verify-delivery and cancel requests on the same order.
-- Restricted to service_role: SECURITY DEFINER bypasses RLS, so an
-- unauthenticated/authenticated caller must never be able to lock any order.
CREATE OR REPLACE FUNCTION lock_order_for_update(p_order_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only the backend service can lock orders';
  END IF;

  PERFORM 1 FROM orders WHERE id = p_order_id FOR UPDATE;
END;
$$;

-- RPC: cancel_order_tx — Cancel an order and initiate escrow refund atomically.
-- Combines the status update and escrow_status transition in a single
-- transaction with row-level locking, preventing race conditions.
-- Authorization is derived from the caller's JWT via get_profile_id(): the
-- owning customer or service_role may cancel. The caller-supplied
-- p_customer_id is never trusted for authorization (it is kept only for
-- signature compatibility).
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

  IF v_order.status IN ('picked_up', 'in_transit', 'arriving', 'arrived_dropoff') THEN
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

-- SECURITY DEFINER functions bypass RLS, so default PUBLIC EXECUTE must be
-- revoked. Only the backend (service_role) may lock/cancel orders; the owning
-- customer path is enforced inside cancel_order_tx via get_profile_id().
REVOKE EXECUTE ON FUNCTION public.lock_order_for_update(UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_order_tx(UUID, TEXT, UUID) FROM anon, authenticated;

COMMIT;
