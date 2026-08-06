-- =============================================================================
-- Migration: accept_bid_tx must trust only the stored bid row (Issue #5777)
-- =============================================================================
-- Problem:
--   accept_bid_tx is SECURITY DEFINER and accepted p_bid_id, p_load_id,
--   p_driver_id, p_driver_name, p_driver_rating, p_truck_id, p_truck_number,
--   p_bid_amount and p_order_display_id verbatim from the caller. It validated
--   only that the load offer was 'available' and the order 'pending', then wrote
--   all caller-supplied values onto the order. Any owning customer (or a
--   compromised backend client) could accept an arbitrary/nonexistent bid id,
--   assign any driver/truck, and set the order amount to any value — including
--   inflating total_amount/bid_amount so a later complete_trip_tx credits an
--   inflated wallet amount.
--
-- Fix:
--   Resolve the bid from p_bid_id and derive the load_offer + order chain from
--   it. All caller-supplied bid/driver/truck/amount/order fields are ignored;
--   the driver identity, display snapshot (name/rating/truck), and bid amount
--   are taken only from the stored load_bids row and the related tables. The
--   function fails closed if no matching pending bid exists.
-- =============================================================================

CREATE OR REPLACE FUNCTION accept_bid_tx(
  p_bid_id           uuid,
  p_order_id         uuid,
  p_load_id          uuid,
  p_driver_id        uuid,
  p_driver_name      text,
  p_driver_rating    numeric,
  p_truck_id         uuid,
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
  v_customer_id      uuid;
  v_load_id          uuid;
  v_driver_id        uuid;
  v_bid_amount       int;
  v_order_display_id text;
  v_load_status      text;
  v_order_status     text;
  v_current_version  int;
  v_driver_name      text;
  v_driver_rating    numeric;
  v_truck_id         uuid;
  v_truck_number     text;
  v_pending_acceptance jsonb;
  v_pending_bid_amount  int;
BEGIN
  -- Resolve the bid by p_bid_id and derive the load/order chain from it.
  -- The caller-supplied p_load_id/p_order_id/p_order_display_id/p_driver_id/
  -- p_driver_name/p_driver_rating/p_truck_id/p_truck_number/p_bid_amount are
  -- intentionally NOT used anywhere below.
  SELECT b.load_id, b.driver_id, b.bid_amount,
         lo.order_display_id, lo.status
    INTO v_load_id, v_driver_id, v_bid_amount,
         v_order_display_id, v_load_status
    FROM load_bids b
    JOIN load_offers lo ON lo.id = b.load_id
   WHERE b.id = p_bid_id
     AND b.status = 'pending'
     FOR UPDATE OF b, lo;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bid not found or no longer pending';
  END IF;

  IF v_load_status IS NULL OR v_load_status <> 'available' THEN
    RAISE EXCEPTION 'Load offer is no longer available';
  END IF;

  SELECT customer_id, status, version, pending_bid_acceptance
    INTO v_customer_id, v_order_status, v_current_version, v_pending_acceptance
    FROM orders
   WHERE order_display_id = v_order_display_id
     FOR UPDATE;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- The order must carry a two-phase acceptance snapshot. Compare the amount
  -- the customer agreed to and funded with the amount still stored on the bid
  -- row. If the bid was rewritten after acceptance (e.g. by a driver inflating
  -- bid_amount), refuse to finalize so escrow can never pay out more than was
  -- actually funded.
  IF v_pending_acceptance IS NULL THEN
    RAISE EXCEPTION 'Pending bid acceptance snapshot is missing';
  END IF;

  v_pending_bid_amount := (v_pending_acceptance->>'bid_amount')::int;

  IF v_pending_bid_amount IS NULL OR v_bid_amount <> v_pending_bid_amount THEN
    RAISE EXCEPTION 'Bid amount was modified after acceptance; refusing to finalize';
  END IF;

  IF auth.role() <> 'service_role'
     AND (auth.uid() IS NULL OR get_profile_id() <> v_customer_id) THEN
    RAISE EXCEPTION 'Unauthorized: you can only accept bids on your own orders';
  END IF;

  IF v_order_status IS NULL OR v_order_status <> 'pending' THEN
    RAISE EXCEPTION 'Order is no longer pending';
  END IF;

  IF v_current_version != p_expected_version THEN
    RAISE EXCEPTION 'OPTIMISTIC_LOCK_FAIL';
  END IF;

  -- Derive the driver display snapshot from the DB, never from the caller.
  SELECT p.full_name, dd.rating, dd.truck_id
    INTO v_driver_name, v_driver_rating, v_truck_id
    FROM profiles p
    LEFT JOIN driver_details dd ON dd.user_id = p.id
   WHERE p.id = v_driver_id;

  IF v_driver_name IS NULL THEN
    v_driver_name := 'Assigned Driver';
  END IF;
  v_driver_rating := COALESCE(v_driver_rating, 0.00);

  SELECT number_plate INTO v_truck_number
    FROM trucks
   WHERE id = v_truck_id;

  UPDATE load_bids
    SET status = 'accepted', updated_at = now()
    WHERE id = p_bid_id;

  UPDATE load_bids
    SET status = 'rejected', updated_at = now()
    WHERE load_id = v_load_id
      AND id != p_bid_id;

  UPDATE load_offers
    SET status = 'claimed', updated_at = now()
    WHERE id = v_load_id;

  UPDATE orders
    SET driver_id          = v_driver_id,
        truck_id           = v_truck_id,
        status             = 'truck_assigned',
        driver_name        = v_driver_name,
        driver_rating      = v_driver_rating,
        truck_number       = v_truck_number,
        total_amount       = v_bid_amount,
        bid_amount         = v_bid_amount,
        escrow_booking_id  = COALESCE(p_escrow_booking_id, escrow_booking_id),
        pending_bid_acceptance = NULL,
        version            = version + 1,
        updated_at         = now()
    WHERE order_display_id = v_order_display_id;

  UPDATE order_timeline
    SET completed      = true,
        milestone_time = now()
    WHERE order_display_id = v_order_display_id
      AND milestone = 'Truck Assigned';
END;
$$;
