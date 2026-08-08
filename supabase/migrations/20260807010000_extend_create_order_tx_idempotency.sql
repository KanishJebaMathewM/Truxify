-- ============================================================================
-- TRANSACTIONAL ORDER CREATION WITH DURABLE IDEMPOTENCY (issue #7135)
-- ============================================================================
-- Prior to this migration the backend performed the idempotency handshake as
-- three SEPARATE RPCs:
--
--   claim_order_idempotency_key  →  create_order_tx  →  complete_order_idempotency_key
--
-- A crash between create_order_tx committing and the completion call left the
-- registry row in 'claimed' state. A retry within the lease window was rejected
-- with 409 in_progress, and after the lease expired the key was re-acquired and
-- a SECOND order + load offer were created — violating at-most-once.
--
-- This migration folds claim → create → complete into a SINGLE transaction so
-- the idempotency record, the order, its timeline, and the load offer commit
-- or roll back together. Postgres arbitrates concurrent same-key requests via
-- the (user_id, idempotency_key) unique index: the loser of the race blocks on
-- the winning transaction, then observes its committed 'completed' row and
-- replays the stored 2xx response instead of creating a duplicate.
--
-- The function reuses claim_order_idempotency_key / complete_order_idempotency_key
-- from migration 20260807000000 so lease, fingerprint, and replay semantics stay
-- in one place. Because PL/pgSQL functions called here share the caller's
-- transaction, the registry writes are atomic with the domain inserts.
--
-- RETURN CONTRACT (unchanged when no key is supplied):
--   no key:            { id, order_display_id, status, created_at }
--   fresh creation:    { idempotent: true, outcome: 'created',   response: {message, order} }
--   replay of success: { idempotent: true, outcome: 'replayed',  response: {message, order} }
--   key + new payload: { idempotent: true, outcome: 'conflict' }
--   in-flight claim:   { idempotent: true, outcome: 'in_progress' }
-- ============================================================================


create or replace function create_order_tx(
  p_order_display_id text,
  p_customer_id uuid,
  p_customer_name text,
  p_pickup_address text,
  p_pickup_lat numeric,
  p_pickup_lng numeric,
  p_drop_address text,
  p_drop_lat numeric,
  p_drop_lng numeric,
  p_pickup_date text,
  p_pickup_time text,
  p_goods_type text,
  p_weight_tonnes numeric,
  p_length_ft numeric,
  p_width_ft numeric,
  p_height_ft numeric,
  p_is_stackable boolean,
  p_is_fragile boolean,
  p_special_requirements text,
  p_base_freight numeric,
  p_toll_estimate numeric,
  p_platform_fee numeric,
  p_total_amount numeric,
  p_estimated_price numeric,
  p_payment_method_id text,
  p_upi_id text,
  p_route_label text,
  p_route_subtitle text,
  p_weight_text text,
  p_fuel_cost numeric,
  p_net_profit numeric,
  p_extra_distance_km numeric,
  p_idempotency_key text default null,
  p_request_fingerprint text default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_status text;
  v_created_at timestamptz;
  v_customer_id uuid;
  v_claim jsonb;
  v_order_json jsonb;
  v_response jsonb;
begin
  -- Resolve the customer identity: only the service-role backend may supply a
  -- p_customer_id. Any other caller is bound to their own JWT-derived profile
  -- id (get_profile_id maps the Firebase JWT sub to profiles.id), so clients
  -- can never create orders or load offers as another customer.
  if auth.role() = 'service_role' then
    v_customer_id := p_customer_id;
  else
    v_customer_id := get_profile_id();
    if v_customer_id is null then
      raise exception 'Unauthorized: could not resolve caller profile';
    end if;
    if p_customer_id is not null and p_customer_id <> v_customer_id then
      raise exception 'Unauthorized: cannot create orders as another customer';
    end if;
  end if;

  -- Durable idempotency: acquire (or replay) the key inside this transaction.
  -- A concurrent same-key request blocks on the unique index until this
  -- transaction resolves; on commit it sees 'completed' and replays.
  if p_idempotency_key is not null then
    v_claim := claim_order_idempotency_key(
      p_user_id := v_customer_id,
      p_key := p_idempotency_key,
      p_fingerprint := p_request_fingerprint,
      p_lease_interval := interval '2 minutes'
    );

    if v_claim->>'status' = 'completed' then
      return json_build_object(
        'idempotent', true,
        'outcome', 'replayed',
        'response', v_claim->'response'
      );
    elsif v_claim->>'status' = 'conflict' then
      return json_build_object('idempotent', true, 'outcome', 'conflict');
    elsif v_claim->>'status' = 'in_progress' then
      return json_build_object('idempotent', true, 'outcome', 'in_progress');
    end if;
    -- status = 'claimed' → this worker owns the key; proceed with creation.
  end if;

  -- 1. Insert into orders
  insert into orders (
    order_display_id, customer_id, status,
    pickup_address, pickup_lat, pickup_lng,
    drop_address, drop_lat, drop_lng,
    pickup_date, pickup_time,
    goods_type, weight_tonnes, length_ft, width_ft, height_ft,
    is_stackable, is_fragile, special_requirements,
    base_freight, toll_estimate, platform_fee, total_amount, estimated_price,
    payment_method_id, upi_id
  ) values (
    p_order_display_id, v_customer_id, 'pending',
    p_pickup_address, p_pickup_lat, p_pickup_lng,
    p_drop_address, p_drop_lat, p_drop_lng,
    p_pickup_date, p_pickup_time,
    p_goods_type, p_weight_tonnes, p_length_ft, p_width_ft, p_height_ft,
    p_is_stackable, p_is_fragile, p_special_requirements,
    p_base_freight, p_toll_estimate, p_platform_fee, p_total_amount, p_estimated_price,
    p_payment_method_id, p_upi_id
  ) returning id, status, created_at into v_order_id, v_status, v_created_at;

  -- 2. Insert into order_timeline
  insert into order_timeline (order_display_id, milestone, milestone_time, completed, sort_order)
  values
    (p_order_display_id, 'Order Placed', now(), true, 10),
    (p_order_display_id, 'Truck Assigned', null, false, 20),
    (p_order_display_id, 'En Route to Pickup', null, false, 30),
    (p_order_display_id, 'Arrived at Pickup', null, false, 35),
    (p_order_display_id, 'Goods Loaded', null, false, 40),
    (p_order_display_id, 'In Transit', null, false, 50),
    (p_order_display_id, 'Arriving', null, false, 55),
    (p_order_display_id, 'Delivered', null, false, 60);

  -- 3. Insert into load_offers
  insert into load_offers (
    order_display_id, customer_id, customer_name,
    route_label, route_subtitle,
    pickup_address, pickup_lat, pickup_lng,
    drop_address, drop_lat, drop_lng,
    goods_type, weight,
    freight_value, fuel_cost, toll_cost, net_profit, extra_distance_km,
    status
  ) values (
    p_order_display_id, v_customer_id, p_customer_name,
    p_route_label, p_route_subtitle,
    p_pickup_address, p_pickup_lat, p_pickup_lng,
    p_drop_address, p_drop_lat, p_drop_lng,
    p_goods_type, p_weight_text,
    p_total_amount, p_fuel_cost, p_toll_estimate, p_net_profit, p_extra_distance_km,
    'available'
  );

  v_order_json := json_build_object(
    'id', v_order_id,
    'order_display_id', p_order_display_id,
    'status', v_status,
    'created_at', v_created_at
  );

  if p_idempotency_key is not null then
    -- Complete the key atomically with the domain writes: a crash after this
    -- transaction commits leaves a 'completed' row, so a retry replays the
    -- original response instead of creating a duplicate order.
    v_response := json_build_object(
      'message', 'Order created successfully and broadcasted to loads board.',
      'order', v_order_json
    );
    perform complete_order_idempotency_key(
      p_user_id := v_customer_id,
      p_key := p_idempotency_key,
      p_status := 'completed',
      p_response_payload := v_response,
      p_results := v_order_json
    );
    return json_build_object(
      'idempotent', true,
      'outcome', 'created',
      'response', v_response
    );
  end if;

  return v_order_json;
end;
$$;
