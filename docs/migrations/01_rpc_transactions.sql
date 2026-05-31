-- RPC 1: Accept bid atomically
CREATE OR REPLACE FUNCTION accept_bid_tx(
  p_bid_id        UUID,
  p_order_id      UUID,
  p_load_id       UUID,
  p_driver_id     UUID,
  p_truck_id      UUID,
  p_driver_name   TEXT,
  p_driver_rating NUMERIC,
  p_truck_number  TEXT,
  p_bid_amount    INT,
  p_order_display_id TEXT
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
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
    SET driver_id     = p_driver_id,
        truck_id      = p_truck_id,
        status        = 'truck_assigned',
        driver_name   = p_driver_name,
        driver_rating = p_driver_rating,
        truck_number  = p_truck_number,
        total_amount  = p_bid_amount,
        updated_at    = now()
    WHERE id = p_order_id;

  UPDATE order_timeline
    SET completed      = true,
        milestone_time = now()
    WHERE order_display_id = p_order_display_id
      AND milestone = 'Truck Assigned';
END;
$$;

-- RPC 2: Withdraw funds atomically
CREATE OR REPLACE FUNCTION withdraw_funds_tx(
  p_driver_id   UUID,
  p_amount      INT
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_confirmed INT;
  v_pending   INT;
BEGIN
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
