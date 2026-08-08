-- =============================================================================
-- Migration: RPC ownership checks must resolve the caller to profiles.id
-- (Issue #6275)
-- =============================================================================
-- Problem:
--   Truxify authenticates through Firebase. backend/api/src/middleware/auth.js
--   resolves each JWT to a profiles row and sets req.user.id = userProfile.id
--   (a random gen_random_uuid()), while the Firebase UID lives in
--   profiles.firebase_uid. In Postgres, auth.uid() is the Firebase UID (the
--   auth.users row id).
--
--   withdraw_funds_tx, submit_rating_tx and accept_bid_tx verified ownership by
--   comparing auth.uid() against a caller-supplied (or stored) profiles.id.
--   Because the two identifiers never match for a real authenticated user, the
--   guard always raised and withdrawals/ratings/bid-acceptance were blocked.
--   update_order_tx (20260802000000:54) and complete_trip_tx
--   (20260803100000:31) were already migrated to the get_profile_id() pattern;
--   these three functions were not.
--
-- Fix:
--   Redefine all three functions to compare get_profile_id() (which maps the
--   Firebase JWT sub to profiles.id) instead of the raw auth.uid(). The backend
--   already passes profiles.id (req.user.id) as p_driver_id/p_customer_id, so
--   no API change is required. The service_role bypass on accept_bid_tx (used
--   by escrow-funding reconciliation and confirm-deposit) is preserved.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. withdraw_funds_tx — verify the caller IS the driver by profiles.id
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION withdraw_funds_tx(
  p_driver_id   UUID,
  p_amount      INT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_confirmed  INT;
  v_pending    INT;
  v_day_total  INT;
  v_daily_cap  CONSTANT INT := 10000000;  -- ₹1,00,000 in paisa per UTC calendar day
BEGIN
  -- Verify the caller IS the driver. get_profile_id() maps the Firebase JWT
  -- sub to profiles.id, which is what p_driver_id/req.user.id actually store
  -- (auth.uid() is the Firebase UID and would never match).
  IF auth.uid() IS NOT NULL AND get_profile_id() <> p_driver_id THEN
    RAISE EXCEPTION 'Unauthorized: you can only withdraw your own funds';
  END IF;

  -- Reject non-positive amounts: a negative p_amount would otherwise mint
  -- wallet_confirmed via wallet_confirmed = v_confirmed - p_amount.
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be a positive whole number of paisa';
  END IF;

  -- Lock the wallet row first so the daily cap decision and the balance
  -- movement are serialized: two concurrent withdrawals from the same driver
  -- cannot both read the same v_day_total and both pass the cap check.
  SELECT wallet_confirmed, wallet_pending
    INTO v_confirmed, v_pending
    FROM driver_details
   WHERE user_id = p_driver_id
     FOR UPDATE;

  -- Enforce the per-driver per-day withdrawal cap under the row lock.
  SELECT COALESCE(SUM(amount), 0)
    INTO v_day_total
    FROM wallet_transactions
   WHERE driver_id  = p_driver_id
     AND txn_type   = 'withdrawal'
     AND created_at >= date_trunc('day', now());

  IF v_day_total + p_amount > v_daily_cap THEN
    RAISE EXCEPTION 'Daily withdrawal cap exceeded: % of % used',
      v_day_total + p_amount, v_daily_cap;
  END IF;

  IF v_confirmed IS NULL OR v_confirmed < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance: available %, requested %',
      COALESCE(v_confirmed, 0), p_amount;
  END IF;

  -- Move funds from confirmed → pending.
  UPDATE driver_details
     SET wallet_confirmed = v_confirmed - p_amount,
         wallet_pending   = v_pending   + p_amount,
         updated_at       = now()
   WHERE user_id = p_driver_id;

  -- Log the withdrawal transaction.
  INSERT INTO wallet_transactions
    (driver_id, amount, txn_type, status, description)
  VALUES
    (p_driver_id, p_amount, 'withdrawal', 'pending',
     'Withdrawal to registered bank account');
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. submit_rating_tx — verify the caller IS the customer by profiles.id
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION submit_rating_tx(
  p_order_display_id TEXT,
  p_customer_id      UUID,
  p_driver_id        UUID,
  p_stars            SMALLINT,
  p_comment          TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_avg NUMERIC(3,2);
BEGIN
  -- Verify the caller IS the customer. get_profile_id() maps the Firebase JWT
  -- sub to profiles.id, which is what p_customer_id/req.user.id actually store
  -- (auth.uid() is the Firebase UID and would never match).
  IF auth.uid() IS NOT NULL AND get_profile_id() <> p_customer_id THEN
    RAISE EXCEPTION 'Unauthorized: you can only submit ratings for yourself';
  END IF;

  -- Validate star rating is between 1 and 5
  IF p_stars < 1 OR p_stars > 5 THEN
    RAISE EXCEPTION 'Star rating must be between 1 and 5, got %', p_stars;
  END IF;

  -- Validate the order exists, is owned by the caller, is delivered or paid,
  -- and that p_driver_id is the driver assigned to that order.
  IF NOT EXISTS (
    SELECT 1
    FROM orders
    WHERE order_display_id = p_order_display_id
      AND customer_id      = p_customer_id
      AND driver_id        = p_driver_id
      AND status           IN ('delivered', 'payment_released')
  ) THEN
    RAISE EXCEPTION 'Order not found or not eligible for rating: the order must be delivered or payment released, owned by you, and completed by this driver';
  END IF;

  -- Upsert: first call inserts, subsequent calls replace the rating values.
  INSERT INTO ratings (order_display_id, customer_id, driver_id, stars, comment)
  VALUES (p_order_display_id, p_customer_id, p_driver_id, p_stars, p_comment)
  ON CONFLICT (order_display_id, customer_id)
  DO UPDATE SET
    stars      = EXCLUDED.stars,
    comment    = EXCLUDED.comment,
    updated_at = NOW();

  -- Recalculate the driver's average rating across all their ratings.
  SELECT ROUND(AVG(stars)::NUMERIC, 2)
  INTO v_new_avg
  FROM ratings
  WHERE driver_id = p_driver_id;

  UPDATE driver_details
  SET rating     = v_new_avg,
      updated_at = now()
  WHERE user_id = p_driver_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. accept_bid_tx — verify the caller IS the order's customer by profiles.id
-- ─────────────────────────────────────────────────────────────────────────────
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

  SELECT customer_id, status, version
    INTO v_customer_id, v_order_status, v_current_version
    FROM orders
   WHERE order_display_id = v_order_display_id
     FOR UPDATE;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Ownership guard: the backend (service_role, e.g. confirm-deposit and
  -- escrow-funding reconciliation) may always finalize. An authenticated
  -- customer must own the order. get_profile_id() maps the Firebase JWT sub to
  -- profiles.id, which is what orders.customer_id actually stores (auth.uid()
  -- is the Firebase UID and would never match).
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
