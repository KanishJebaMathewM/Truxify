-- Migration: Add auth.uid() verification to critical RPC functions
-- This fixes privilege escalation vulnerability where any authenticated user could
-- call these functions directly via Supabase REST API, bypassing Node.js backend authorization.
-- Issue: #1851

-- RPC 1: accept_bid_tx — Accept a driver's bid on a load offer atomically
-- Verify caller is the customer who owns the order
CREATE OR REPLACE FUNCTION accept_bid_tx(
  p_bid_id           UUID,
  p_order_id         UUID,
  p_load_id          UUID,
  p_driver_id        UUID,
  p_truck_id         UUID,
  p_driver_name      TEXT,
  p_driver_rating    NUMERIC,
  p_truck_number     TEXT,
  p_bid_amount       INT,
  p_order_display_id TEXT,
  p_escrow_booking_id TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_load_status TEXT;
  v_order_status TEXT;
  v_customer_id UUID;
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

  SELECT status INTO v_order_status
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_status IS NULL OR v_order_status <> 'pending' THEN
    RAISE EXCEPTION 'Order is no longer pending';
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
      escrow_booking_id = COALESCE(p_escrow_booking_id, escrow_booking_id),
      updated_at       = now()
  WHERE id = p_order_id;

  UPDATE order_timeline
  SET completed      = true,
      milestone_time = now()
  WHERE order_display_id = p_order_display_id
    AND milestone = 'Truck Assigned';
END;
$$;

-- RPC 2: withdraw_funds_tx — Withdraw from driver wallet atomically with locking
-- Verify caller is the driver
CREATE OR REPLACE FUNCTION withdraw_funds_tx(
  p_driver_id   UUID,
  p_amount      INT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
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

  IF v_confirmed < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance: available %, requested %',
      v_confirmed, p_amount;
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

-- RPC 3: submit_rating_tx — Submit rating and recalculate driver average
-- Verify caller is the customer
CREATE OR REPLACE FUNCTION submit_rating_tx(
  p_order_display_id TEXT,
  p_customer_id      UUID,
  p_driver_id        UUID,
  p_stars            SMALLINT,
  p_comment          TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_avg NUMERIC(3,2);
BEGIN
  -- Verify the caller IS the customer
  IF auth.uid() <> p_customer_id THEN
    RAISE EXCEPTION 'Unauthorized: you can only submit ratings for yourself';
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
