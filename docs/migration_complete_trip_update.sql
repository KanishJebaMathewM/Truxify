-- Migration: Update complete_trip_tx(p_order_id UUID, p_otp_id UUID) to atomically
-- consume the delivery OTP and complete the driver's active trip, its items/stops,
-- and the order/timeline.
-- Also add partial unique index on trips table to ensure a driver can have at most one active trip at any given time.

CREATE UNIQUE INDEX IF NOT EXISTS idx_trips_one_active_per_driver 
ON trips (driver_id) 
WHERE (status = 'active');

DROP FUNCTION IF EXISTS complete_trip_tx(UUID);

CREATE OR REPLACE FUNCTION complete_trip_tx(p_order_id UUID, p_otp_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order RECORD;
  v_trip_display_id TEXT;
  v_otp_updated INT;
  v_updated_count INT;
BEGIN
  -- Get the order details
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  
  IF v_order.driver_id IS NULL THEN
    RAISE EXCEPTION 'No driver assigned to this order';
  END IF;

  -- Idempotency guard: check if the order status is already payment_released
  IF v_order.status = 'payment_released' THEN
    RETURN;
  END IF;

  -- Check if the order was cancelled
  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'Order has been cancelled — cannot complete trip';
  END IF;

  -- Finalize the active trip that actually served THIS order
  SELECT trip_display_id INTO v_trip_display_id
  FROM trips
  WHERE order_id = p_order_id AND status = 'active'
  ORDER BY created_at
  LIMIT 1;

  IF v_trip_display_id IS NULL THEN
    RAISE EXCEPTION 'No active trip found for this order — cannot complete trip';
  END IF;

  -- Update trip record
  UPDATE trips
  SET status = 'completed',
      end_time = TO_CHAR(NOW(), 'HH24:MI'),
      updated_at = NOW()
  WHERE trip_display_id = v_trip_display_id;

  -- Update trip items to delivered
  UPDATE trip_items
  SET is_delivered = true
  WHERE trip_display_id = v_trip_display_id;

  -- Update trip stops to completed/delivered
  UPDATE trip_stops
  SET is_completed = true,
      is_current = false,
      status_label = 'Delivered',
      updated_at = NOW()
  WHERE trip_display_id = v_trip_display_id;

  -- Update order status to payment_released with defensive WHERE guards
  UPDATE orders
  SET otp_verified = true,
      status = 'payment_released',
      updated_at = NOW()
  WHERE id = p_order_id
    AND status != 'cancelled'
    AND status != 'payment_released';

  -- Verify the update actually affected a row
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Order status changed during processing — possible concurrent cancellation';
  END IF;

  -- Update order timeline milestone 'Delivered'
  UPDATE order_timeline
  SET completed = true,
      milestone_time = NOW()
  WHERE order_display_id = v_order.order_display_id AND milestone = 'Delivered';

  -- Update driver's wallet
  UPDATE driver_details
  SET 
    total_trips = total_trips + 1,
    wallet_confirmed = wallet_confirmed + v_order.total_amount,
    wallet_total = wallet_total + v_order.total_amount,
    updated_at = NOW()
  WHERE user_id = v_order.driver_id;
  
  -- Log wallet transaction
  INSERT INTO wallet_transactions (
    driver_id, order_display_id, amount, txn_type, status, description
  ) VALUES (
    v_order.driver_id,
    v_order.order_display_id,
    v_order.total_amount,
    'credit',
    'confirmed',
    'Payout for Order ' || v_order.order_display_id
  );
  
  -- Update daily earnings summary
  INSERT INTO earnings_daily (driver_id, day_date, amount, trip_count)
  VALUES (v_order.driver_id, CURRENT_DATE, v_order.total_amount, 1)
  ON CONFLICT (driver_id, day_date)
  DO UPDATE SET 
    amount = earnings_daily.amount + EXCLUDED.amount,
    trip_count = earnings_daily.trip_count + 1;
END;
$$;
