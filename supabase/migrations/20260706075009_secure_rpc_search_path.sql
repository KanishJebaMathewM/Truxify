-- Migration to fix search_path for all SECURITY DEFINER functions

CREATE OR REPLACE FUNCTION complete_trip_tx(p_order_id UUID, p_otp_id UUID, p_release_tx_hash TEXT DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order RECORD;
  v_trip_display_id TEXT;
  v_active_trip_count INT;
  v_otp_updated INT;
BEGIN
  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Verify the caller IS the driver assigned to this order
  IF auth.uid() <> v_order.driver_id THEN
    RAISE EXCEPTION 'Unauthorized: you can only complete trips you are assigned to';
  END IF;

  IF v_order.driver_id IS NULL THEN
    RAISE EXCEPTION 'No driver assigned to this order';
  END IF;

  IF v_order.status = 'payment_released' THEN
    RETURN;
  END IF;

  -- Only proceed with wallet credit if escrow was released on-chain
  IF v_order.escrow_status IN ('funded', 'release_failed') AND p_release_tx_hash IS NULL THEN
    RAISE EXCEPTION 'Blockchain escrow release must complete before crediting driver wallet';
  END IF;

  UPDATE delivery_otps
  SET verified = true,
      verified_at = NOW()
  WHERE id = p_otp_id
    AND order_id = p_order_id
    AND verified = false
    AND expires_at >= NOW();

  GET DIAGNOSTICS v_otp_updated = ROW_COUNT;
  IF v_otp_updated <> 1 THEN
    RAISE EXCEPTION 'Delivery OTP is invalid, expired, or already verified';
  END IF;

  SELECT COUNT(*) INTO v_active_trip_count
  FROM trips
  WHERE driver_id = v_order.driver_id
    AND status = 'active';

  IF v_active_trip_count > 1 THEN
    RAISE EXCEPTION 'Multiple active trips found for driver %', v_order.driver_id;
  END IF;

  IF v_active_trip_count = 1 THEN
    SELECT trip_display_id INTO v_trip_display_id
    FROM trips
    WHERE driver_id = v_order.driver_id
      AND status = 'active';

    UPDATE trips
    SET status = 'completed',
        end_time = TO_CHAR(NOW(), 'HH24:MI'),
        updated_at = NOW()
    WHERE trip_display_id = v_trip_display_id;

    UPDATE trip_items
    SET is_delivered = true
    WHERE trip_display_id = v_trip_display_id;

    UPDATE trip_stops
    SET is_completed = true,
        is_current = false,
        status_label = 'Delivered',
        updated_at = NOW()
    WHERE trip_display_id = v_trip_display_id;
  END IF;

  UPDATE orders
  SET status = 'payment_released',
      updated_at = NOW()
  WHERE id = p_order_id;

  UPDATE order_timeline
  SET completed = true,
      milestone_time = NOW()
  WHERE order_display_id = v_order.order_display_id
    AND milestone = 'Delivered';

  -- Use COALESCE to prefer bid_amount (immutable) over total_amount (mutable)
  UPDATE driver_details
  SET total_trips = total_trips + 1,
      wallet_confirmed = wallet_confirmed + COALESCE(v_order.bid_amount, v_order.total_amount, 0),
      wallet_total = wallet_total + COALESCE(v_order.bid_amount, v_order.total_amount, 0),
      updated_at = NOW()
  WHERE user_id = v_order.driver_id;

  INSERT INTO wallet_transactions (
    driver_id,
    order_display_id,
    amount,
    txn_type,
    status,
    description
  ) VALUES (
    v_order.driver_id,
    v_order.order_display_id,
    COALESCE(v_order.bid_amount, v_order.total_amount, 0),
    'credit',
    'confirmed',
    'Payout for Order ' || v_order.order_display_id
  );

  INSERT INTO earnings_daily (driver_id, day_date, amount, trip_count)
  VALUES (v_order.driver_id, CURRENT_DATE, COALESCE(v_order.bid_amount, v_order.total_amount, 0), 1)
  ON CONFLICT (driver_id, day_date)
  DO UPDATE SET
    amount = earnings_daily.amount + EXCLUDED.amount,
    trip_count = earnings_daily.trip_count + 1;
END;
$$;

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
  v_load_status text;
  v_order_status text;
  v_current_version int;
  v_customer_id uuid;
BEGIN
  SELECT status INTO v_load_status
    FROM load_offers
    WHERE id = p_load_id
    FOR UPDATE;

  IF v_load_status IS NULL OR v_load_status <> 'available' THEN
    RAISE EXCEPTION 'Load offer is no longer available';
  END IF;

  SELECT status, version, customer_id INTO v_order_status, v_current_version, v_customer_id
    FROM orders
    WHERE id = p_order_id
    FOR UPDATE;

  IF v_order_status IS NULL OR v_order_status <> 'pending' THEN
    RAISE EXCEPTION 'Order is no longer pending';
  END IF;

  IF auth.uid() <> v_customer_id THEN
    RAISE EXCEPTION 'Not authorized to accept bids for this order';
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

CREATE OR REPLACE FUNCTION withdraw_funds_tx(
  p_driver_id   UUID,
  p_amount      INT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_confirmed INT;
  v_pending   INT;
BEGIN
  -- Verify the caller IS the driver
  IF auth.uid() <> p_driver_id THEN
    RAISE EXCEPTION 'Unauthorized: you can only withdraw your own funds';
  END IF;

  SELECT wallet_confirmed, wallet_pending
  INTO v_confirmed, v_pending
  FROM driver_details
  WHERE user_id = p_driver_id
  FOR UPDATE;

  IF COALESCE(v_confirmed, 0) < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance: available %, requested %',
      COALESCE(v_confirmed, 0), p_amount;
  END IF;

  UPDATE driver_details
  SET wallet_confirmed = v_confirmed - p_amount,
      wallet_pending   = v_pending   + p_amount,
      updated_at       = now()
  WHERE user_id = p_driver_id;

  INSERT INTO wallet_transactions
    (driver_id, amount, txn_type, status, description)
  VALUES
    (p_driver_id, p_amount, 'withdrawal', 'pending',
     'Withdrawal to registered bank account');
END;
$$;

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
  -- Verify the caller IS the customer
  IF auth.uid() <> p_customer_id THEN
    RAISE EXCEPTION 'Unauthorized: you can only submit ratings for yourself';
  END IF;

  -- Validate star rating is between 1 and 5
  IF p_stars < 1 OR p_stars > 5 THEN
    RAISE EXCEPTION 'Star rating must be between 1 and 5, got %', p_stars;
  END IF;

  INSERT INTO ratings (order_display_id, customer_id, driver_id, stars, comment)
  VALUES (p_order_display_id, p_customer_id, p_driver_id, p_stars, p_comment);

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

