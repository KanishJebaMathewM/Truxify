-- =============================================================================
-- Migration: complete_trip_tx may be finalized by service_role without an OTP
-- (escrow release reconciliation worker)
-- =============================================================================
-- Problem:
--   escrowReleaseReconciliation heals the release→finalize failure window by
--   calling complete_trip_tx as service_role (see
--   20260805120000_secure_complete_trip_tx_auth.sql). But the RPC unconditionally
--   validates p_otp_id: the delivery OTP may already be verified (the release
--   only ever happens through the OTP-confirmed flow) or expired by the time the
--   worker runs, so `v_otp_updated <> 1` always raised and the trip could never
--   be finalized or the driver credited.
--
-- Fix:
--   A service_role caller may pass p_otp_id = NULL to skip OTP validation. The
--   driver-facing path is unchanged: non-service_role callers must still supply
--   a valid, unexpired OTP, and a service_role call that DOES pass an OTP still
--   validates it. The fail-closed escrow gate is untouched — the wallet is only
--   credited when escrow_status = 'released' (persisted by the worker before the
--   call) or a release tx hash is supplied, and idempotency on
--   status = 'payment_released' still guarantees exactly-once credit.
-- =============================================================================

create or replace function complete_trip_tx(
  p_order_id uuid,
  p_otp_id uuid,
  p_release_tx_hash text default null
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

  -- Verify the caller is the driver assigned to this order. get_profile_id()
  -- maps the Firebase JWT sub to profiles.id, which is what orders.driver_id
  -- stores (auth.uid() is the Firebase UID and would never match). Fail closed:
  -- when the role cannot be established (coalesce(auth.role(), '') <> 'service_role')
  -- OR the caller's profile does not resolve to the assigned driver
  -- (get_profile_id() IS DISTINCT FROM v_order.driver_id, true when NULL), the
  -- RPC rejects. service_role (the backend) is exempt because the app layer
  -- already enforces driver assignment, OTP hashing, lockout and geofence.
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

  -- OTP validation. The driver-facing path always passes a validated OTP. The
  -- release reconciliation worker (service_role) finalizes trips whose OTP was
  -- already verified/expired by the time it runs, so it may pass NULL — but a
  -- non-service_role caller can never skip the OTP.
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

  -- Fail closed (restored from 20260802130000_complete_trip_tx_require_funded_escrow.sql):
  -- credit the driver wallet ONLY when the escrow was actually funded and released
  -- on-chain (`escrow_status = 'released'` or a release tx hash is supplied), or
  -- when the order is explicitly marked `escrow_disabled`. Any ambiguous/unfunded
  -- state raises instead of crediting.
  if not v_order.escrow_disabled
     and coalesce(v_order.escrow_status, '') <> 'released'
     and p_release_tx_hash is null then
    raise exception 'Blockchain escrow release must complete before crediting driver wallet';
  end if;

  -- Finalize the active trip that actually served THIS order (restored from
  -- 20260802060000_link_trips_to_orders.sql: selecting by driver_id could
  -- complete the wrong trip when a driver has several active trips, and it
  -- silently skipped trip finalization when the driver had no active trip).
  -- When no linked trip exists the order is still finalized below so the
  -- driver payout is never lost (#6325).
  select trip_display_id into v_trip_display_id
  from trips
  where order_id = p_order_id
    and status = 'active'
  order by created_at
  limit 1;

  if v_trip_display_id is not null then
    -- Update trip record
    update trips
    set status = 'completed',
        end_time = to_char(now(), 'HH24:MI'),
        updated_at = now()
    where trip_display_id = v_trip_display_id;

    -- Update trip items to delivered
    update trip_items
    set is_delivered = true
    where trip_display_id = v_trip_display_id;

    -- Update trip stops to completed/delivered
    update trip_stops
    set is_completed = true,
        is_current = false,
        status_label = 'Delivered',
        updated_at = now()
    where trip_display_id = v_trip_display_id;
  end if;

  -- Update order status and escrow details. Escrow fields are only synced for
  -- escrow-backed orders (the fail-closed guard above guarantees the escrow was
  -- released on-chain); escrow-disabled orders never enter the escrow lifecycle,
  -- so their escrow_status must not be rewritten to 'released'.
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

  -- Verify the update actually affected a row
  get diagnostics v_updated_count = row_count;
  if v_updated_count = 0 then
    raise exception 'Order status changed during processing — possible concurrent cancellation';
  end if;

  -- Update order timeline milestone 'Delivered'
  update order_timeline
  set completed = true,
      milestone_time = now()
  where order_display_id = v_order.order_display_id and milestone = 'Delivered';

  -- Update driver's wallet
  update driver_details
  set
    total_trips = total_trips + 1,
    wallet_confirmed = wallet_confirmed + v_order.total_amount,
    wallet_total = wallet_total + v_order.total_amount,
    updated_at = now()
  where user_id = v_order.driver_id;

  -- Log wallet transaction
  insert into wallet_transactions (
    driver_id, order_display_id, amount, txn_type, status, description
  ) values (
    v_order.driver_id,
    v_order.order_display_id,
    v_order.total_amount,
    'credit',
    'confirmed',
    'Payout for Order ' || v_order.order_display_id
  );

  -- Update daily earnings summary
  insert into earnings_daily (driver_id, day_date, amount, trip_count)
  values (v_order.driver_id, current_date, v_order.total_amount, 1)
  on conflict (driver_id, day_date)
  do update set
    amount = earnings_daily.amount + excluded.amount,
    trip_count = earnings_daily.trip_count + 1;

  driver_id := v_order.driver_id;
  return next;
end;
$$;

-- Only service_role (the backend) may invoke this RPC. Revoke the default
-- PUBLIC grant (anon/authenticated are members of PUBLIC) as well as the
-- explicit anon/authenticated grants so direct PostgREST invocation is
-- impossible; then grant execution to service_role explicitly.
REVOKE EXECUTE ON FUNCTION complete_trip_tx(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_trip_tx(uuid, uuid, text) TO service_role;
