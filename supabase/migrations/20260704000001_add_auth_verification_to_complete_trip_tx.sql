-- Migration: Add auth.uid() verification to complete_trip_tx function
-- This fixes privilege escalation vulnerability where any authenticated user could
-- call this function directly via Supabase REST API, bypassing Node.js backend authorization.
-- Issue: #1851

DROP FUNCTION IF EXISTS complete_trip_tx(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION complete_trip_tx(p_order_id UUID, p_otp_id UUID, p_release_tx_hash TEXT DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
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

  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot complete a cancelled order';
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
      wallet_confirmed = wallet_confirmed + COALESCE(v_order.bid_amount, v_order.total_amount),
      wallet_total = wallet_total + COALESCE(v_order.bid_amount, v_order.total_amount),
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
    COALESCE(v_order.bid_amount, v_order.total_amount),
    'credit',
    'confirmed',
    'Payout for Order ' || v_order.order_display_id
  );

  INSERT INTO earnings_daily (driver_id, day_date, amount, trip_count)
  VALUES (v_order.driver_id, CURRENT_DATE, COALESCE(v_order.bid_amount, v_order.total_amount), 1)
  ON CONFLICT (driver_id, day_date)
  DO UPDATE SET
    amount = earnings_daily.amount + EXCLUDED.amount,
    trip_count = earnings_daily.trip_count + 1;
END;
$$;
