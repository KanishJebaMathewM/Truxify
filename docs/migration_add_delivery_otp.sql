-- Migration: Add delivery OTP functionality to orders table
-- Add columns for delivery OTP
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_otp TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS otp_verified BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS otp_generated_at TIMESTAMPTZ;

-- RPC Function: Complete trip and release payment to driver (by order ID)
CREATE OR REPLACE FUNCTION complete_trip_tx(p_order_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order RECORD;
BEGIN
  -- Get the order details
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  
  IF v_order.driver_id IS NULL THEN
    RAISE EXCEPTION 'No driver assigned to this order';
  END IF;

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
