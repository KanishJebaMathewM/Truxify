-- =============================================================================
-- Migration: complete_trip_tx requires driver_details row
-- =============================================================================
-- Problem:
--   complete_trip_tx credits the driver wallet via an UPDATE on driver_details.
--   If the driver_details row is missing, the update silently affects 0 rows,
--   leaving the driver uncredited while marking the order 'payment_released'.
--
-- Fix:
--   Add a row-count check after the driver_details UPDATE. If affected rows
--   equals 0, raise an exception to abort and roll back the transaction.
-- =============================================================================

create or replace function complete_trip_tx(
  p_order_id uuid,
  p_otp_id uuid,
  p_release_tx_hash text default null,
  p_hours_driven numeric(4,2) default 0.00
)
returns table(driver_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order record;
  v_trip_display_id text;
  v_updated_count int;
  v_otp_updated int;
begin
  -- Use FOR UPDATE to lock the order row and prevent concurrent modifications
  select * into v_order from orders where id = p_order_id for update;

  if not found then
    raise exception 'Order not found';
  end if;

  -- Verify the caller is the driver assigned to this order
  if coalesce(auth.role(), '') <> 'service_role'
     and get_profile_id() is distinct from v_order.driver_id then
    raise exception 'Unauthorized: you can only complete trips you are assigned to';
  end if;

  if v_order.driver_id is null then
    raise exception 'No driver assigned to this order';
  end if;

  -- Idempotency guard: check if the order status is already payment_released
  if v_order.status = 'payment_released' then
    driver_id := v_order.driver_id;
    return next;
    return;
  end if;

  -- OTP validation
  if p_otp_id is null then
    if coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'Delivery OTP is required';
    end if;
  else
    update delivery_otps
    set verified = true,
        verified_at = now()
    where id = p_otp_id
      and order_id = p_order_id
      and verified = false
      and expires_at >= now();

    get diagnostics v_otp_updated = row_count;
    if v_otp_updated <> 1 then
      raise exception 'Delivery OTP is invalid, expired, or already verified';
    end if;
  end if;

  -- Check if the order was cancelled
  if v_order.status = 'cancelled' then
    raise exception 'Order has been cancelled — cannot complete trip';
  end if;

  -- Check if the order was already delivered — prevents double-processing
  if v_order.status = 'delivered' then
    raise exception 'Order has already been delivered';
  end if;

  -- Fail closed: escrow must be released
  if not v_order.escrow_disabled
     and coalesce(v_order.escrow_status, '') <> 'released'
     and p_release_tx_hash is null then
    raise exception 'Blockchain escrow release must complete before crediting driver wallet';
  end if;

  -- Finalize the active trip
  select trip_display_id into v_trip_display_id
  from trips
  where order_id = p_order_id
    and status = 'active'
  order by created_at
  limit 1;

  if v_trip_display_id is not null then
    update trips
    set status = 'completed',
        end_time = to_char(now(), 'HH24:MI'),
        net_earnings = coalesce(v_order.bid_amount, v_order.total_amount),
        updated_at = now()
    where trip_display_id = v_trip_display_id;

    update trip_items
    set is_delivered = true
    where trip_display_id = v_trip_display_id;

    update trip_stops
    set is_completed = true,
        is_current = false,
        status_label = 'Delivered',
        updated_at = now()
    where trip_display_id = v_trip_display_id;
  end if;

  -- Update order status and escrow details
  if v_order.escrow_disabled then
    update orders
    set status = 'payment_released',
        blockchain_tx_hash = coalesce(p_release_tx_hash, blockchain_tx_hash),
        updated_at = now()
    where id = p_order_id
      and status != 'cancelled'
      and status != 'payment_released';
  else
    update orders
    set status = 'payment_released',
        escrow_status = 'released',
        escrow_released_at = now(),
        blockchain_tx_hash = coalesce(p_release_tx_hash, blockchain_tx_hash),
        updated_at = now()
    where id = p_order_id
      and status != 'cancelled'
      and status != 'payment_released';
  end if;

  get diagnostics v_updated_count = row_count;
  if v_updated_count = 0 then
    raise exception 'Order status changed during processing — possible concurrent cancellation';
  end if;

  -- Update order timeline milestone 'Delivered'
  update order_timeline
  set completed = true,
      milestone_time = now()
  where order_display_id = v_order.order_display_id and milestone = 'Delivered';

  -- Update driver's wallet (using bid_amount payout basis, falling back to total_amount)
  update driver_details
  set
    total_trips = total_trips + 1,
    wallet_confirmed = wallet_confirmed + coalesce(v_order.bid_amount, v_order.total_amount),
    wallet_total = wallet_total + coalesce(v_order.bid_amount, v_order.total_amount),
    updated_at = now()
  where user_id = v_order.driver_id;

  -- Verify that the wallet update actually affected a row (driver_details exists)
  get diagnostics v_updated_count = row_count;
  if v_updated_count = 0 then
    raise exception 'driver_details record not found for driver % — wallet cannot be credited', v_order.driver_id;
  end if;

  -- Log wallet transaction
  insert into wallet_transactions (
    driver_id, order_display_id, amount, txn_type, status, description
  ) values (
    v_order.driver_id,
    v_order.order_display_id,
    coalesce(v_order.bid_amount, v_order.total_amount),
    'credit',
    'confirmed',
    'Payout for Order ' || v_order.order_display_id
  );

  -- Update daily earnings summary
  insert into earnings_daily (driver_id, day_date, amount, trip_count, hours_driven)
  values (v_order.driver_id, current_date, coalesce(v_order.bid_amount, v_order.total_amount), 1, p_hours_driven)
  on conflict (driver_id, day_date)
  do update set
    amount = earnings_daily.amount + excluded.amount,
    trip_count = earnings_daily.trip_count + 1,
    hours_driven = earnings_daily.hours_driven + excluded.hours_driven;

  driver_id := v_order.driver_id;
  return next;
end;
$$;

REVOKE EXECUTE ON FUNCTION complete_trip_tx(uuid, uuid, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_trip_tx(uuid, uuid, text, numeric) TO service_role;
