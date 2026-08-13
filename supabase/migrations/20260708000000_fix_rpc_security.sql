-- Migration: Fix RPC security — restore auth.uid() checks and secure remaining functions
-- ------------------------------------------------------------------------------
-- Issues addressed:
--   1. accept_bid_tx lost its auth.uid() verification in 20260704124000 (version
--      locking refactor). Re-add customer-ownership check.
--   2. claim_refund_reconciliation and claim_release_reconciliation are SECURITY
--      DEFINER but lack both auth.role() restriction and SET search_path — any
--      authenticated user could call them via the REST API.
-- ------------------------------------------------------------------------------

-- ─── RPC 1: accept_bid_tx — restore auth.uid() verification ───
CREATE OR REPLACE FUNCTION accept_bid_tx(
  p_bid_id           uuid,
  p_order_id         uuid,
  p_load_id          uuid,
  p_driver_id        uuid,
  p_truck_id         uuid,
  p_driver_name      text,
  p_driver_rating    numeric,
  p_truck_number     text,
  p_bid_amount       int,
  p_order_display_id text,
  p_expected_version int,
  p_escrow_booking_id text default null
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_id uuid;
  v_load_status text;
  v_order_status text;
  v_current_version int;
BEGIN
  -- Verify the caller is the customer who owns the order
  SELECT customer_id INTO v_customer_id
  FROM orders
  WHERE id = p_order_id;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF auth.uid() <> v_customer_id THEN
    RAISE EXCEPTION 'Unauthorized: you can only accept bids on your own orders';
  END IF;

  SELECT status INTO v_load_status
    FROM load_offers
    WHERE id = p_load_id
    FOR UPDATE;

  IF v_load_status IS NULL OR v_load_status <> 'available' THEN
    RAISE EXCEPTION 'Load offer is no longer available';
  END IF;

  SELECT status, version INTO v_order_status, v_current_version
    FROM orders
    WHERE id = p_order_id
    FOR UPDATE;

  IF v_order_status IS NULL OR v_order_status <> 'pending' THEN
    RAISE EXCEPTION 'Order is no longer pending';
  END IF;

  IF v_current_version != p_expected_version THEN
    RAISE EXCEPTION 'OPTIMISTIC_LOCK_FAIL';
  END IF;

  UPDATE load_bids
    SET status = 'accepted', updated_at = now()
    WHERE id = p_bid_id;

  UPDATE load_bids
    SET status = 'rejected', updated_at = now()
    WHERE load_id = p_load_id
      AND id != p_bid_id;

  UPDATE load_offers
    SET status = 'claimed', updated_at = now()
    WHERE id = p_load_id;

  UPDATE orders
    SET driver_id        = p_driver_id,
        truck_id         = p_truck_id,
        status           = 'truck_assigned',
        driver_name      = p_driver_name,
        driver_rating    = p_driver_rating,
        truck_number     = p_truck_number,
        total_amount     = p_bid_amount,
        bid_amount       = p_bid_amount,
        escrow_booking_id = coalesce(p_escrow_booking_id, escrow_booking_id),
        version          = version + 1,
        updated_at       = now()
    WHERE id = p_order_id;

  UPDATE order_timeline
    SET completed      = true,
        milestone_time = now()
    WHERE order_display_id = p_order_display_id
      AND milestone = 'Truck Assigned';
END;
$$;


-- ─── RPC 2: claim_refund_reconciliation — restrict to service_role ───
CREATE OR REPLACE FUNCTION claim_refund_reconciliation(p_order_id UUID, p_instance_id TEXT)
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
    AND escrow_status = 'refund_pending'
    AND (reconciled_by IS NULL OR reconciled_at < NOW() - INTERVAL '10 minutes')
  RETURNING *;
END;
$$;


-- ─── RPC 3: claim_release_reconciliation — restrict to service_role ───
CREATE OR REPLACE FUNCTION claim_release_reconciliation(p_order_id UUID, p_instance_id TEXT)
RETURNS SETOF orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only the backend service can claim release reconciliation rows';
  END IF;

  RETURN QUERY
  UPDATE orders
  SET
    escrow_release_attempts = escrow_release_attempts + 1,
    escrow_release_last_attempt_at = NOW(),
    reconciled_by = p_instance_id,
    reconciled_at = NOW()
  WHERE id = p_order_id
    AND escrow_status = 'release_failed'
    AND (reconciled_by IS NULL OR reconciled_at < NOW() - INTERVAL '10 minutes')
  RETURNING *;
END;
$$;


-- ─── RPC 4: release_reconciliation_lease — clear a stuck claim ───
-- Called by the reaper (or a worker on failure) to free a row whose claiming
-- instance died before completing the on-chain release/refund. Without this the
-- next sweep would skip the row forever because its predicate requires
-- reconciled_by IS NULL, stranding the payout/refund.
CREATE OR REPLACE FUNCTION release_reconciliation_lease(p_order_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only the backend service can release leases';
  END IF;

  UPDATE orders SET reconciled_by = NULL, reconciled_at = NULL
   WHERE id = p_order_id AND reconciled_by IS NOT NULL;
END;
$$;


-- ─── RPC 5: reap_stale_reconciliation_leases — reaper for stranded claims ───
-- Frees reconciliation leases whose claiming instance has held the row longer
-- than the 10-minute lease window without completing the on-chain op. A held
-- (reconciled_by non-NULL) row with escrow_status still pending/failed is a
-- crashed worker: reset it so another instance can re-claim via the claim RPCs.
CREATE OR REPLACE FUNCTION reap_stale_reconciliation_leases(p_lease_interval INTERVAL DEFAULT INTERVAL '10 minutes')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reaped integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only the backend service can reap reconciliation leases';
  END IF;

  WITH stale AS (
    SELECT id FROM orders
     WHERE reconciled_by IS NOT NULL
       AND reconciled_at < NOW() - p_lease_interval
       AND escrow_status IN ('release_failed', 'refund_pending')
  )
  SELECT count(*) INTO v_reaped FROM stale;

  PERFORM release_reconciliation_lease(id) FROM stale;

  RETURN v_reaped;
END;
$$;
