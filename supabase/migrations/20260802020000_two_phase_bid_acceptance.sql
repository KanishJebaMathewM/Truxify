-- =============================================================================
-- Migration: Two-phase bid acceptance (Issue #5724)
-- =============================================================================
-- Problem:
--   acceptBid persisted escrow_status='funding' and THEN synchronously ran
--   accept_bid_tx, which flipped orders.status to 'truck_assigned', claimed
--   the load_offer, and rejected all rival bids — all BEFORE the customer ever
--   funded the escrow on-chain. A customer who never funded the deposit left
--   the driver committed, the load claimed forever, and the order stuck in
--   truck_assigned/funding indefinitely.
--
-- Fix (three parts):
--   1. TWO-PHASE ACCEPTANCE — acceptBid only reserves the bid and persists the
--      escrow booking reference plus a pending_bid_acceptance context on the
--      order. accept_bid_tx (which commits the driver, claims the load, and
--      rejects rivals) now runs only from confirm-deposit, AFTER the on-chain
--      deposit has been verified via recordDepositTx. If funding never lands, a
--      TTL sweeper reverts the order (see escrowFundingReconciliation worker).
--   2. allow accept_bid_tx to be invoked by the backend service_role (needed by
--      confirm-deposit and the funding-reconciliation worker, which have no
--      customer JWT), while still requiring the owning customer otherwise.
--   3. tracking columns for the funding-reconciliation worker.
-- =============================================================================

-- Reserve context persisted at accept time, consumed by confirm-deposit.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pending_bid_acceptance JSONB;

-- Funding reconciliation tracking (mirrors escrow_refund_*/escrow_release_*).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS escrow_funding_started_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS escrow_funding_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS escrow_funding_last_attempt_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS escrow_funding_error TEXT;

-- ─── accept_bid_tx — allow service_role (backend) OR owning customer ───
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
  -- Verify the caller is the customer who owns the order, unless it is the
  -- backend service (confirm-deposit / funding reconciliation worker).
  SELECT customer_id INTO v_customer_id
  FROM orders
  WHERE id = p_order_id;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF auth.role() <> 'service_role'
     AND (auth.uid() IS NULL OR auth.uid() <> v_customer_id) THEN
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
        pending_bid_acceptance = NULL,
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
