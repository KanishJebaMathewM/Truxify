-- Migration: Add critical RPC functions (accept_bid_tx, withdraw_funds_tx, submit_rating_tx)
-- These functions existed only in docs/supabase_setup.sql and were missing from migrations.
-- Fresh deployments using only migration files would get 500 errors on bid acceptance,
-- wallet withdrawals, and rating submission.

-- RPC 1: accept_bid_tx — Accept a driver's bid on a load offer atomically
-- Called from: POST /api/orders/:id/bids/:bidId/accept
create or replace function accept_bid_tx(
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
  p_escrow_booking_id text default null
) returns void
language plpgsql
security definer
-- Set search_path to avoid search_path injection attacks
set search_path = public
as $
declare
  v_load_status text;
  v_order_status text;
begin
  select status into v_load_status
    from load_offers
    where id = p_load_id
    for update;

  if v_load_status is null or v_load_status <> 'available' then
    raise exception 'Load offer is no longer available';
  end if;

  select status into v_order_status
    from orders
    where id = p_order_id
    for update;

  if v_order_status is null or v_order_status <> 'pending' then
    raise exception 'Order is no longer pending';
  end if;

  update load_bids
    set status = 'accepted', updated_at = now()
    where id = p_bid_id;

  update load_bids
    set status = 'rejected', updated_at = now()
    where load_id = p_load_id
      and id != p_bid_id;

  update load_offers
    set status = 'claimed', updated_at = now()
    where id = p_load_id;

  update orders
    set driver_id        = p_driver_id,
        truck_id         = p_truck_id,
        status           = 'truck_assigned',
        driver_name      = p_driver_name,
        driver_rating    = p_driver_rating,
        truck_number     = p_truck_number,
        total_amount     = p_bid_amount,
        bid_amount       = p_bid_amount,
        escrow_booking_id = coalesce(p_escrow_booking_id, escrow_booking_id),
        updated_at       = now()
    where id = p_order_id;

  update order_timeline
    set completed      = true,
        milestone_time = now()
    where order_display_id = p_order_display_id
      and milestone = 'Truck Assigned';
end;
$$;

-- RPC 2: withdraw_funds_tx — Withdraw from driver wallet atomically with locking
-- Called from: POST /api/drivers/wallet/withdraw
create or replace function withdraw_funds_tx(
  p_driver_id   uuid,
  p_amount      int
) returns void
language plpgsql
security definer
-- Set search_path to avoid search_path injection attacks
set search_path = public
as $
declare
  v_confirmed int;
  v_pending   int;
begin
  select wallet_confirmed, wallet_pending
    into v_confirmed, v_pending
    from driver_details
    where user_id = p_driver_id
    for update;

  if v_confirmed < p_amount then
    raise exception 'Insufficient balance: available %, requested %',
      v_confirmed, p_amount;
  end if;

  update driver_details
    set wallet_confirmed = v_confirmed - p_amount,
        wallet_pending   = v_pending   + p_amount,
        updated_at       = now()
    where user_id = p_driver_id;

  insert into wallet_transactions
    (driver_id, amount, txn_type, status, description)
  values
    (p_driver_id, p_amount, 'withdrawal', 'pending',
     'Withdrawal to registered bank account');
end;
$$;

-- RPC 3: submit_rating_tx — Submit rating and recalculate driver average
-- Called from: POST /api/ratings
create or replace function submit_rating_tx(
  p_order_display_id text,
  p_customer_id      uuid,
  p_driver_id        uuid,
  p_stars            smallint,
  p_comment          text default null
) returns void
language plpgsql
security definer
-- Set search_path to avoid search_path injection attacks
set search_path = public
as $
declare
  v_new_avg numeric(3,2);
begin
  if p_stars < 1 or p_stars > 5 then
    raise exception 'Star rating must be between 1 and 5, got %', p_stars;
  end if;

  insert into ratings (order_display_id, customer_id, driver_id, stars, comment)
  values (p_order_display_id, p_customer_id, p_driver_id, p_stars, p_comment);

  select round(avg(stars)::numeric, 2)
    into v_new_avg
    from ratings
    where driver_id = p_driver_id;

  update driver_details
    set rating     = v_new_avg,
        updated_at = now()
    where user_id = p_driver_id;
end;
$$;
