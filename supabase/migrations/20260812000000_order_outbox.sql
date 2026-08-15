-- =============================================================================
-- TRANSACTIONAL OUTBOX — Durable order state-transition events
-- =============================================================================
-- Problem:
--   The canonical order mutation path wrote directly to `orders` and relied on
--   best-effort Kafka publication afterwards. If the application crashed (or
--   Kafka was unavailable) between the DB commit and the publish, the order
--   state stayed committed but its event was lost forever — consumers
--   (read models, notifications, analytics) never learned about the change.
--
-- Fix:
--   A transactional outbox. Every order state-transition RPC now performs the
--   order mutation AND inserts an `order_outbox` row inside ONE database
--   transaction, so the event is committed atomically with the order change.
--   A separate relay (backend/kafka/relay/outboxRelay.js) polls unpublished
--   rows, publishes them to Kafka, and only then marks them published. Kafka
--   being down never loses an event — it only delays publication.
--
--   The outbox row carries both the aggregate id (`order_id`, the real
--   orders.id UUID) and its own unique `event_id`, keeping the two identifiers
--   separate as required.
--
-- SECURITY MODEL:
--   - `order_outbox` is written by the backend via service_role and is never
--     exposed to clients, so RLS allows service_role only.
--   - The claim/mark/fail RPCs are SECURITY DEFINER and gated on
--     auth.role() = 'service_role' so direct REST invocation is impossible.
--   - Mutation RPCs are re-created (CREATE OR REPLACE, established repo
--     pattern) to insert the outbox row via the internal helper inside their
--     own transaction.
-- =============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. OUTBOX TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists order_outbox (
  id               uuid not null default gen_random_uuid(),
  event_id         text not null,               -- outbox event's own id (Kafka message id)
  order_id         uuid not null,               -- orders.id aggregate id
  order_display_id text,                        -- orders.order_display_id
  event_type       text not null,               -- e.g. 'ORDER_CREATED'
  topic            text not null,               -- kafka topic derived from event_type
  payload          jsonb not null default '{}'::jsonb,
  metadata         jsonb,                       -- { eventId, eventType, source, timestamp, ... }
  created_at       timestamptz not null default now(),
  published        boolean not null default false,
  published_at     timestamptz,
  attempts         integer not null default 0,  -- publish attempt count (retry budget)
  last_error       text,                        -- last publish error (bounded length)
  next_attempt_at  timestamptz not null default now(),  -- backoff-controlled retry time
  claimed_by       text,                        -- relay instance currently holding the row
  claimed_at       timestamptz,                 -- lease expiry baseline
  primary key (id),
  unique (event_id)
);

-- Fast lookup of the next batch of unpublished events by the relay.
create index if not exists idx_order_outbox_unpublished
  on order_outbox (published, next_attempt_at, created_at);

create index if not exists idx_order_outbox_order
  on order_outbox (order_id);

create index if not exists idx_order_outbox_type
  on order_outbox (event_type);

alter table order_outbox enable row level security;

drop policy if exists "Service role full access on order_outbox" on order_outbox;
create policy "Service role full access on order_outbox"
  on order_outbox
  for all to service_role
  using (true)
  with check (true);

revoke all on table order_outbox from anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. EVENT TYPE -> KAFKA TOPIC MAPPING
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.order_outbox_topic_for_event(p_event_type text)
returns text
language sql
immutable
as $$
  select case p_event_type
    when 'ORDER_CREATED'    then 'order.created'
    when 'ORDER_UPDATED'    then 'order.updated'
    when 'ORDER_CANCELLED'  then 'order.cancelled'
    when 'DRIVER_ASSIGNED'  then 'driver.assigned'
    when 'DRIVER_UPDATED'   then 'driver.updated'
    when 'PAYMENT_CONFIRMED' then 'payment.confirmed'
    when 'PAYMENT_RELEASED' then 'payment.released'
    when 'ESCROW_CREATED'   then 'escrow.created'
    when 'ESCROW_RELEASED'  then 'escrow.released'
    when 'TRIP_STARTED'     then 'trip.started'
    when 'TRIP_COMPLETED'   then 'trip.completed'
    when 'FRAUD_DETECTED'   then 'fraud.detected'
    when 'ETA_UPDATED'      then 'eta.updated'
    when 'LOCATION_UPDATED' then 'location.updated'
    when 'NOTIFICATION_SENT' then 'notification.sent'
    else null
  end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. INTERNAL HELPER — append an outbox row (and event-store row) atomically
-- ────────────────────────────────────────────────────────────────────────────
-- Called from within the SECURITY DEFINER mutation RPCs, so it always runs in
-- the same transaction as the order change. Direct REST invocation is revoked.
create or replace function public.add_order_outbox_event(
  p_order_id         uuid,
  p_order_display_id text,
  p_event_type       text,
  p_payload          jsonb,
  p_metadata         jsonb default null
)
returns text  -- the generated event_id
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id  text   := gen_random_uuid()::text;
  v_topic     text;
  v_metadata  jsonb;
begin
  v_topic := public.order_outbox_topic_for_event(p_event_type);
  if v_topic is null then
    raise exception 'No Kafka topic mapped for outbox event type "%"', p_event_type;
  end if;

  v_metadata := coalesce(p_metadata, jsonb_build_object(
    'eventId',      v_event_id,
    'eventType',    p_event_type,
    'source',       'order-service',
    'category',     'domain',
    'version',      '1.0',
    'correlationId', null,
    'causationId',  null,
    'timestamp',    now()
  ));

  insert into order_outbox (event_id, order_id, order_display_id, event_type, topic, payload, metadata)
  values (v_event_id, p_order_id, p_order_display_id, p_event_type, v_topic, p_payload, v_metadata);

  -- Keep the event store / CQRS read model in sync (same transaction). The
  -- events table is the source for order.read.model.js; if it does not exist
  -- the outbox remains fully functional.
  if to_regclass('public.events') is not null then
    insert into events (event_id, event_type, order_id, data, metadata, timestamp)
    values (v_event_id, p_event_type, p_order_id::text, p_payload, v_metadata, now());
  end if;

  return v_event_id;
end;
$$;

revoke execute on function public.add_order_outbox_event(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.add_order_outbox_event(uuid, text, text, jsonb, jsonb) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RELAY RPCs — claim / publish / fail
-- ────────────────────────────────────────────────────────────────────────────
-- claim: atomically claim the next batch of unpublished events. `FOR UPDATE
-- SKIP LOCKED` lets multiple relay replicas race safely: each event is leased
-- to exactly one instance for p_lease_seconds. Events beyond the attempt
-- budget are no longer claimed (no unbounded retries).
create or replace function public.claim_order_outbox_events(
  p_limit          integer,
  p_instance_id    text,
  p_lease_seconds  integer default 60,
  p_max_attempts   integer default 15
)
returns setof order_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff timestamptz := now() - make_interval(secs => p_lease_seconds);
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only the backend service can claim outbox events';
  end if;

  return query
    update order_outbox
       set claimed_by = p_instance_id,
           claimed_at = now()
     where id in (
       select id
         from order_outbox
        where published = false
          and attempts < p_max_attempts
          and next_attempt_at <= now()
          and (claimed_at is null or claimed_at < v_cutoff)
        order by created_at
        limit p_limit
        for update skip locked
     )
     returning *;
end;
$$;

create or replace function public.mark_order_outbox_published(p_event_id text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only the backend service can mark outbox events published';
  end if;

  update order_outbox
     set published    = true,
         published_at = now(),
         claimed_by   = null,
         claimed_at   = null
   where event_id = p_event_id
     and published = false;

  return found;
end;
$$;

create or replace function public.fail_order_outbox_event(p_event_id text, p_error text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only the backend service can fail outbox events';
  end if;

  select attempts into v_attempts
    from order_outbox
   where event_id = p_event_id
     for update;

  if v_attempts is null then
    return false;
  end if;

  update order_outbox
     set attempts    = v_attempts + 1,
         last_error  = left(coalesce(p_error, 'unknown error'), 2000),
         next_attempt_at = now() + least(interval '10 minutes', (interval '1 second' * power(2, v_attempts))),
         claimed_by  = null,
         claimed_at  = null
   where event_id = p_event_id;

  return true;
end;
$$;

revoke execute on function public.claim_order_outbox_events(integer, text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_order_outbox_events(integer, text, integer, integer) to service_role;

revoke execute on function public.mark_order_outbox_published(text) from public, anon, authenticated;
grant execute on function public.mark_order_outbox_published(text) to service_role;

revoke execute on function public.fail_order_outbox_event(text, text) from public, anon, authenticated;
grant execute on function public.fail_order_outbox_event(text, text) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. GENERIC STATUS-TRANSITION RPC
-- ────────────────────────────────────────────────────────────────────────────
-- Locks the order row FOR UPDATE, applies an optional status guard, performs
-- the mutation and writes the outbox event atomically. Used by the milestone
-- and customer-cancel paths. Returns zero rows when the guard fails so
-- PostgREST callers observe the familiar PGRST116 "no rows" conflict.
create or replace function public.update_order_status_tx(
  p_order_id                      uuid,
  p_status                        text,
  p_not_statuses                  text[] default null,
  p_escrow_in_statuses            text[] default null,
  p_cancellation_reason           text default null,
  p_cancellation_fee              numeric default null,
  p_escrow_status                 text default null,
  p_escrow_refund_attempts        integer default null,
  p_escrow_refund_error           text default null,
  p_escrow_refund_last_attempt_at timestamptz default null,
  p_refund_tx_hash                text default null,
  p_escrow_refunded_at            timestamptz default null,
  p_escrow_refund_submitted_at    timestamptz default null,
  p_clear_escrow_refund_error     boolean default false,
  p_event_type                    text default 'ORDER_UPDATED',
  p_payload_extra                 jsonb default null,
  p_skip_event                    boolean default false
)
returns setof orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order   orders%ROWTYPE;
  v_payload jsonb;
begin
  select * into v_order from orders where id = p_order_id for update;

  if v_order.id is null then
    raise exception 'Order not found';
  end if;

  -- Status guard: the caller opts out of mutating a forbidden current status.
  if p_not_statuses is not null and v_order.status = any(p_not_statuses) then
    return;
  end if;

  -- Escrow-status guard: the caller opts out unless the current escrow state
  -- is one of the allowed values (refund-confirmed transition).
  if p_escrow_in_statuses is not null
     and (v_order.escrow_status is null or not v_order.escrow_status = any(p_escrow_in_statuses)) then
    return;
  end if;

  update orders
     set status                        = p_status,
         updated_at                    = now(),
         cancellation_reason           = coalesce(p_cancellation_reason, cancellation_reason),
         cancellation_fee              = coalesce(p_cancellation_fee, cancellation_fee),
         escrow_status                 = coalesce(p_escrow_status, escrow_status),
         escrow_refund_attempts        = coalesce(p_escrow_refund_attempts, escrow_refund_attempts),
         escrow_refund_error           = case when p_clear_escrow_refund_error
                                              then null
                                              else coalesce(p_escrow_refund_error, escrow_refund_error)
                                         end,
         escrow_refund_last_attempt_at = coalesce(p_escrow_refund_last_attempt_at, escrow_refund_last_attempt_at),
         refund_tx_hash                = coalesce(p_refund_tx_hash, refund_tx_hash),
         escrow_refunded_at            = coalesce(p_escrow_refunded_at, escrow_refunded_at),
         escrow_refund_submitted_at    = coalesce(p_escrow_refund_submitted_at, escrow_refund_submitted_at)
   where id = p_order_id
   returning * into v_order;

  if not p_skip_event then
    v_payload := jsonb_build_object(
      'orderId',         p_order_id::text,
      'order_id',        p_order_id::text,
      'order_display_id', v_order.order_display_id,
      'status',          v_order.status,
      'escrow_status',   v_order.escrow_status
    ) || coalesce(p_payload_extra, '{}'::jsonb);

    perform public.add_order_outbox_event(p_order_id, v_order.order_display_id, p_event_type, v_payload);
  end if;

  return next v_order;
end;
$$;

revoke execute on function public.update_order_status_tx(uuid, text, text[], text[], text, numeric, text, integer, text, timestamptz, text, timestamptz, timestamptz, boolean, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.update_order_status_tx(uuid, text, text[], text[], text, numeric, text, integer, text, timestamptz, text, timestamptz, timestamptz, boolean, text, jsonb, boolean) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. MUTATION RPCs RE-DEFINED TO WRITE THE OUTBOX ATOMICALLY
-- ────────────────────────────────────────────────────────────────────────────

-- 6a. create_order_tx (column-per-arg variant used by orderCreationService)
create or replace function create_order_tx(
  p_order_display_id TEXT,
  p_customer_id UUID,
  p_customer_name TEXT,
  p_pickup_address TEXT,
  p_pickup_lat NUMERIC,
  p_pickup_lng NUMERIC,
  p_drop_address TEXT,
  p_drop_lat NUMERIC,
  p_drop_lng NUMERIC,
  p_pickup_date TEXT,
  p_pickup_time TEXT,
  p_goods_type TEXT,
  p_weight_tonnes NUMERIC,
  p_length_ft NUMERIC,
  p_width_ft NUMERIC,
  p_height_ft NUMERIC,
  p_is_stackable BOOLEAN,
  p_is_fragile BOOLEAN,
  p_special_requirements TEXT,
  p_base_freight NUMERIC,
  p_toll_estimate NUMERIC,
  p_platform_fee NUMERIC,
  p_total_amount NUMERIC,
  p_estimated_price NUMERIC,
  p_payment_method_id TEXT,
  p_upi_id TEXT,
  p_route_label TEXT,
  p_route_subtitle TEXT,
  p_weight_text TEXT,
  p_fuel_cost NUMERIC,
  p_net_profit NUMERIC,
  p_extra_distance_km NUMERIC
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id UUID;
  v_status TEXT;
  v_created_at TIMESTAMPTZ;
  v_customer_id UUID;
BEGIN
  -- Resolve the customer identity: only the service-role backend may supply a
  -- p_customer_id. Any other caller is bound to their own JWT-derived profile
  -- id (get_profile_id maps the Firebase JWT sub to profiles.id).
  IF auth.role() = 'service_role' THEN
    v_customer_id := p_customer_id;
  ELSE
    v_customer_id := get_profile_id();
    IF v_customer_id IS NULL THEN
      RAISE EXCEPTION 'Unauthorized: could not resolve caller profile';
    END IF;
    IF p_customer_id IS NOT NULL AND p_customer_id <> v_customer_id THEN
      RAISE EXCEPTION 'Unauthorized: cannot create orders as another customer';
    END IF;
  END IF;

  -- 1. Insert into orders
  INSERT INTO orders (
    order_display_id, customer_id, status,
    pickup_address, pickup_lat, pickup_lng,
    drop_address, drop_lat, drop_lng,
    pickup_date, pickup_time,
    goods_type, weight_tonnes, length_ft, width_ft, height_ft,
    is_stackable, is_fragile, special_requirements,
    base_freight, toll_estimate, platform_fee, total_amount, estimated_price,
    payment_method_id, upi_id
  ) VALUES (
    p_order_display_id, v_customer_id, 'pending',
    p_pickup_address, p_pickup_lat, p_pickup_lng,
    p_drop_address, p_drop_lat, p_drop_lng,
    p_pickup_date, p_pickup_time,
    p_goods_type, p_weight_tonnes, p_length_ft, p_width_ft, p_height_ft,
    p_is_stackable, p_is_fragile, p_special_requirements,
    p_base_freight, p_toll_estimate, p_platform_fee, p_total_amount, p_estimated_price,
    p_payment_method_id, p_upi_id
  ) RETURNING id, status, created_at INTO v_order_id, v_status, v_created_at;

  -- 2. Insert into order_timeline
  INSERT INTO order_timeline (order_display_id, milestone, milestone_time, completed, sort_order)
  VALUES
    (p_order_display_id, 'Order Placed', NOW(), true, 10),
    (p_order_display_id, 'Truck Assigned', null, false, 20),
    (p_order_display_id, 'En Route to Pickup', null, false, 30),
    (p_order_display_id, 'Arrived at Pickup', null, false, 35),
    (p_order_display_id, 'Goods Loaded', null, false, 40),
    (p_order_display_id, 'In Transit', null, false, 50),
    (p_order_display_id, 'Arriving', null, false, 55),
    (p_order_display_id, 'Delivered', null, false, 60);

  -- 3. Insert into load_offers
  INSERT INTO load_offers (
    order_display_id, customer_id, customer_name,
    route_label, route_subtitle,
    pickup_address, pickup_lat, pickup_lng,
    drop_address, drop_lat, drop_lng,
    goods_type, weight,
    freight_value, fuel_cost, toll_cost, net_profit, extra_distance_km,
    status
  ) VALUES (
    p_order_display_id, v_customer_id, p_customer_name,
    p_route_label, p_route_subtitle,
    p_pickup_address, p_pickup_lat, p_pickup_lng,
    p_drop_address, p_drop_lat, p_drop_lng,
    p_goods_type, p_weight_text,
    p_total_amount, p_fuel_cost, p_toll_estimate, p_net_profit, p_extra_distance_km,
    'available'
  );

  -- 4. Durable outbox event, committed with the order (same transaction).
  PERFORM public.add_order_outbox_event(
    v_order_id,
    p_order_display_id,
    'ORDER_CREATED',
    jsonb_build_object(
      'orderId',          v_order_id::text,
      'order_id',         v_order_id::text,
      'order_display_id', p_order_display_id,
      'status',           v_status,
      'customer_id',      v_customer_id::text,
      'created_at',       v_created_at
    )
  );

  RETURN json_build_object(
    'id', v_order_id,
    'order_display_id', p_order_display_id,
    'status', v_status,
    'created_at', v_created_at
  );
END;
$$;

-- 6b. create_order_tx (idempotent jsonb variant used by createOrderTransactional)
CREATE OR REPLACE FUNCTION create_order_tx(
    p_idempotency_key TEXT,
    p_order_data JSONB,
    p_timeline_data JSONB,
    p_load_offer_data JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing_record RECORD;
    v_order_id UUID;
    v_status TEXT;
    v_customer_id UUID;
    v_result JSONB;
    v_timeline JSONB;
BEGIN
    -- 1. Check existing durable idempotency record
    SELECT * INTO v_existing_record
    FROM order_idempotency_records
    WHERE idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_record.status = 'completed' THEN
            RETURN v_existing_record.response_body;
        ELSIF v_existing_record.status = 'in_progress' AND v_existing_record.created_at > (NOW() - INTERVAL '5 minutes') THEN
            RAISE EXCEPTION 'ORDER_CREATION_IN_PROGRESS' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 2. Upsert in_progress status lock in DB
    INSERT INTO order_idempotency_records (idempotency_key, status, updated_at)
    VALUES (p_idempotency_key, 'in_progress', NOW())
    ON CONFLICT (idempotency_key)
    DO UPDATE SET status = 'in_progress', updated_at = NOW();

    -- Resolve the customer identity: only the service-role backend may supply a
    -- customer_id. Any other caller is bound to their own JWT-derived profile id.
    IF auth.role() = 'service_role' THEN
        v_customer_id := (p_order_data->>'customer_id')::UUID;
    ELSE
        v_customer_id := get_profile_id();
        IF v_customer_id IS NULL THEN
            RAISE EXCEPTION 'Unauthorized: could not resolve caller profile';
        END IF;
        IF (p_order_data->>'customer_id') IS NOT NULL AND (p_order_data->>'customer_id')::UUID <> v_customer_id THEN
            RAISE EXCEPTION 'Unauthorized: cannot create orders as another customer';
        END IF;
    END IF;

    -- 3. Perform atomic Order Creation
    INSERT INTO orders (
        order_display_id, customer_id, status,
        pickup_address, pickup_lat, pickup_lng,
        drop_address, drop_lat, drop_lng,
        pickup_date, pickup_time,
        goods_type, weight_tonnes, length_ft, width_ft, height_ft,
        is_stackable, is_fragile, special_requirements,
        base_freight, toll_estimate, platform_fee, total_amount, estimated_price,
        payment_method_id, upi_id
    ) VALUES (
        p_order_data->>'order_display_id',
        v_customer_id,
        COALESCE(p_order_data->>'status', 'pending'),
        p_order_data->>'pickup_address',
        (p_order_data->>'pickup_lat')::DOUBLE PRECISION,
        (p_order_data->>'pickup_lng')::DOUBLE PRECISION,
        p_order_data->>'drop_address',
        (p_order_data->>'drop_lat')::DOUBLE PRECISION,
        (p_order_data->>'drop_lng')::DOUBLE PRECISION,
        (p_order_data->>'pickup_date')::DATE,
        (p_order_data->>'pickup_time')::TIME,
        p_order_data->>'goods_type',
        (p_order_data->>'weight_tonnes')::NUMERIC,
        (p_order_data->>'length_ft')::NUMERIC,
        (p_order_data->>'width_ft')::NUMERIC,
        (p_order_data->>'height_ft')::NUMERIC,
        COALESCE((p_order_data->>'is_stackable')::BOOLEAN, false),
        COALESCE((p_order_data->>'is_fragile')::BOOLEAN, false),
        CASE WHEN jsonb_typeof(p_order_data->'special_requirements') = 'array'
             THEN (p_order_data->'special_requirements')::TEXT[]
             ELSE NULL END,
        (p_order_data->>'base_freight')::INTEGER,
        (p_order_data->>'toll_estimate')::INTEGER,
        (p_order_data->>'platform_fee')::INTEGER,
        (p_order_data->>'total_amount')::INTEGER,
        (p_order_data->>'estimated_price')::INTEGER,
        (p_order_data->>'payment_method_id')::UUID,
        p_order_data->>'upi_id'
    )
    RETURNING id, status INTO v_order_id, v_status;

    -- 4. Insert Order Timeline milestones
    IF p_timeline_data IS NULL OR jsonb_typeof(p_timeline_data) <> 'array' OR jsonb_array_length(p_timeline_data) = 0 THEN
        INSERT INTO order_timeline (order_display_id, milestone, milestone_time, completed, sort_order)
        VALUES
            (p_order_data->>'order_display_id', 'Order Placed', NOW(), true, 10),
            (p_order_data->>'order_display_id', 'Truck Assigned', NULL, false, 20),
            (p_order_data->>'order_display_id', 'En Route to Pickup', NULL, false, 30),
            (p_order_data->>'order_display_id', 'Arrived at Pickup', NULL, false, 35),
            (p_order_data->>'order_display_id', 'Goods Loaded', NULL, false, 40),
            (p_order_data->>'order_display_id', 'In Transit', NULL, false, 50),
            (p_order_data->>'order_display_id', 'Arriving', NULL, false, 55),
            (p_order_data->>'order_display_id', 'Delivered', NULL, false, 60);
    ELSE
        FOR v_timeline IN SELECT value FROM jsonb_array_elements(p_timeline_data)
        LOOP
            INSERT INTO order_timeline (order_display_id, milestone, milestone_time, completed, sort_order)
            VALUES (
                p_order_data->>'order_display_id',
                v_timeline->>'milestone',
                (v_timeline->>'milestone_time')::TIMESTAMPTZ,
                COALESCE((v_timeline->>'completed')::BOOLEAN, false),
                COALESCE((v_timeline->>'sort_order')::INTEGER, 0)
            );
        END LOOP;
    END IF;

    -- 5. Insert Load Offer record if present
    IF p_load_offer_data IS NOT NULL AND p_load_offer_data != 'null'::jsonb THEN
        INSERT INTO load_offers (
            order_display_id, customer_id, customer_name,
            route_label, route_subtitle,
            pickup_address, pickup_lat, pickup_lng,
            drop_address, drop_lat, drop_lng,
            goods_type, weight,
            freight_value, fuel_cost, toll_cost, net_profit, extra_distance_km,
            status
        ) VALUES (
            p_order_data->>'order_display_id',
            v_customer_id,
            p_load_offer_data->>'customer_name',
            p_load_offer_data->>'route_label',
            p_load_offer_data->>'route_subtitle',
            p_load_offer_data->>'pickup_address',
            (p_load_offer_data->>'pickup_lat')::DOUBLE PRECISION,
            (p_load_offer_data->>'pickup_lng')::DOUBLE PRECISION,
            p_load_offer_data->>'drop_address',
            (p_load_offer_data->>'drop_lat')::DOUBLE PRECISION,
            (p_load_offer_data->>'drop_lng')::DOUBLE PRECISION,
            p_load_offer_data->>'goods_type',
            p_load_offer_data->>'weight',
            (p_load_offer_data->>'freight_value')::INTEGER,
            (p_load_offer_data->>'fuel_cost')::INTEGER,
            (p_load_offer_data->>'toll_cost')::INTEGER,
            (p_load_offer_data->>'net_profit')::INTEGER,
            (p_load_offer_data->>'extra_distance_km')::INTEGER,
            COALESCE(p_load_offer_data->>'status', 'available')
        );
    END IF;

    -- 6. Durable outbox event, committed with the order (same transaction).
    PERFORM public.add_order_outbox_event(
      v_order_id,
      p_order_data->>'order_display_id',
      'ORDER_CREATED',
      jsonb_build_object(
        'orderId',          v_order_id::text,
        'order_id',         v_order_id::text,
        'order_display_id', p_order_data->>'order_display_id',
        'status',           v_status
      )
    );

    -- 7. Store completed result
    v_result := jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'display_id', p_order_data->>'order_display_id',
        'status', v_status
    );

    UPDATE order_idempotency_records
    SET status = 'completed',
        order_id = v_order_id,
        response_body = v_result,
        updated_at = NOW()
    WHERE idempotency_key = p_idempotency_key;

    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    -- On failure, mark idempotency record as failed
    UPDATE order_idempotency_records
    SET status = 'failed',
        updated_at = NOW()
    WHERE idempotency_key = p_idempotency_key;
    RAISE;
END;
$$;

-- 6c. update_order_and_load_offer (change-drop path)
CREATE OR REPLACE FUNCTION update_order_and_load_offer(
  p_order_id UUID,
  p_order_display_id TEXT,
  p_order_updates JSONB,
  p_offer_updates JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_order JSONB;
  v_customer_id   UUID;
BEGIN
  -- Resolve the owning customer of the order for the ownership guard.
  SELECT customer_id INTO v_customer_id
  FROM orders
  WHERE id = p_order_id;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Ownership guard: an authenticated caller may only update their own order.
  IF auth.uid() IS NOT NULL AND get_profile_id() <> v_customer_id THEN
    RAISE EXCEPTION 'Unauthorized: you can only update your own orders';
  END IF;

  -- Only the backend (service_role) may rewrite pricing/payout math.
  IF auth.role() <> 'service_role' THEN
    UPDATE orders
    SET
      drop_address = COALESCE(p_order_updates->>'drop_address', drop_address),
      drop_lat     = COALESCE((p_order_updates->>'drop_lat')::NUMERIC, drop_lat),
      drop_lng     = COALESCE((p_order_updates->>'drop_lng')::NUMERIC, drop_lng),
      updated_at   = COALESCE((p_order_updates->>'updated_at')::TIMESTAMPTZ, updated_at)
    WHERE id = p_order_id
    RETURNING row_to_json(orders.*) INTO v_updated_order;

    UPDATE load_offers
    SET
      drop_address     = COALESCE(p_offer_updates->>'drop_address', drop_address),
      drop_lat         = COALESCE((p_offer_updates->>'drop_lat')::NUMERIC, drop_lat),
      drop_lng         = COALESCE((p_offer_updates->>'drop_lng')::NUMERIC, drop_lng),
      route_label      = COALESCE(p_offer_updates->>'route_label', route_label),
      extra_distance_km = COALESCE((p_offer_updates->>'extra_distance_km')::NUMERIC, extra_distance_km)
    WHERE order_display_id = p_order_display_id;
  ELSE
    UPDATE orders
    SET
      drop_address  = COALESCE(p_order_updates->>'drop_address', drop_address),
      drop_lat      = COALESCE((p_order_updates->>'drop_lat')::NUMERIC, drop_lat),
      drop_lng      = COALESCE((p_order_updates->>'drop_lng')::NUMERIC, drop_lng),
      base_freight  = COALESCE((p_order_updates->>'base_freight')::NUMERIC, base_freight),
      toll_estimate = COALESCE((p_order_updates->>'toll_estimate')::NUMERIC, toll_estimate),
      platform_fee  = COALESCE((p_order_updates->>'platform_fee')::NUMERIC, platform_fee),
      total_amount  = COALESCE((p_order_updates->>'total_amount')::NUMERIC, total_amount),
      updated_at    = COALESCE((p_order_updates->>'updated_at')::TIMESTAMPTZ, updated_at)
    WHERE id = p_order_id
    RETURNING row_to_json(orders.*) INTO v_updated_order;

    UPDATE load_offers
    SET
      drop_address      = COALESCE(p_offer_updates->>'drop_address', drop_address),
      drop_lat          = COALESCE((p_offer_updates->>'drop_lat')::NUMERIC, drop_lat),
      drop_lng          = COALESCE((p_offer_updates->>'drop_lng')::NUMERIC, drop_lng),
      route_label       = COALESCE(p_offer_updates->>'route_label', route_label),
      freight_value     = COALESCE((p_offer_updates->>'freight_value')::NUMERIC, freight_value),
      fuel_cost         = COALESCE((p_offer_updates->>'fuel_cost')::NUMERIC, fuel_cost),
      toll_cost         = COALESCE((p_offer_updates->>'toll_cost')::NUMERIC, toll_cost),
      net_profit        = COALESCE((p_offer_updates->>'net_profit')::NUMERIC, net_profit),
      extra_distance_km = COALESCE((p_offer_updates->>'extra_distance_km')::NUMERIC, extra_distance_km)
    WHERE order_display_id = p_order_display_id;
  END IF;

  -- Durable outbox event, committed with the order (same transaction).
  PERFORM public.add_order_outbox_event(
    p_order_id,
    p_order_display_id,
    'ORDER_UPDATED',
    jsonb_build_object(
      'orderId',          p_order_id::text,
      'order_id',         p_order_id::text,
      'order_display_id', p_order_display_id,
      'status',           v_updated_order->>'status',
      'updates',          p_order_updates
    )
  );

  RETURN v_updated_order;
END;
$$;

-- 6d. accept_bid_tx (driver assignment)
CREATE OR REPLACE FUNCTION accept_bid_tx(
  p_bid_id           uuid,
  p_order_id         uuid,
  p_load_id          uuid,
  p_driver_id        uuid,
  p_driver_name      text,
  p_driver_rating    numeric,
  p_truck_id         uuid,
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
  v_order_id         uuid;
  v_customer_id      uuid;
  v_load_id          uuid;
  v_driver_id        uuid;
  v_bid_amount       int;
  v_order_display_id text;
  v_load_status      text;
  v_order_status     text;
  v_current_version  int;
  v_driver_name      text;
  v_driver_rating    numeric;
  v_truck_id         uuid;
  v_truck_number     text;
  v_pending_acceptance jsonb;
  v_pending_bid_amount  int;
BEGIN
  -- Resolve the bid by p_bid_id and derive the load/order chain from it.
  SELECT b.load_id, b.driver_id, b.bid_amount,
         lo.order_display_id, lo.status
    INTO v_load_id, v_driver_id, v_bid_amount,
         v_order_display_id, v_load_status
    FROM load_bids b
    JOIN load_offers lo ON lo.id = b.load_id
   WHERE b.id = p_bid_id
     AND b.status = 'pending'
     FOR UPDATE OF b, lo;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bid not found or no longer pending';
  END IF;

  IF v_load_status IS NULL OR v_load_status <> 'available' THEN
    RAISE EXCEPTION 'Load offer is no longer available';
  END IF;

  SELECT id, customer_id, status, version, pending_bid_acceptance
    INTO v_order_id, v_customer_id, v_order_status, v_current_version, v_pending_acceptance
    FROM orders
   WHERE order_display_id = v_order_display_id
     FOR UPDATE;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_pending_acceptance IS NULL THEN
    RAISE EXCEPTION 'Pending bid acceptance snapshot is missing';
  END IF;

  v_pending_bid_amount := (v_pending_acceptance->>'bid_amount')::int;

  IF v_pending_bid_amount IS NULL OR v_bid_amount <> v_pending_bid_amount THEN
    RAISE EXCEPTION 'Bid amount was modified after acceptance; refusing to finalize';
  END IF;

  IF auth.role() <> 'service_role'
     AND (auth.uid() IS NULL OR get_profile_id() <> v_customer_id) THEN
    RAISE EXCEPTION 'Unauthorized: you can only accept bids on your own orders';
  END IF;

  IF v_order_status IS NULL OR v_order_status <> 'pending' THEN
    RAISE EXCEPTION 'Order is no longer pending';
  END IF;

  IF v_current_version != p_expected_version THEN
    RAISE EXCEPTION 'OPTIMISTIC_LOCK_FAIL';
  END IF;

  SELECT p.full_name, dd.rating, dd.truck_id
    INTO v_driver_name, v_driver_rating, v_truck_id
    FROM profiles p
    LEFT JOIN driver_details dd ON dd.user_id = p.id
   WHERE p.id = v_driver_id;

  IF v_driver_name IS NULL THEN
    v_driver_name := 'Assigned Driver';
  END IF;
  v_driver_rating := COALESCE(v_driver_rating, 0.00);

  SELECT number_plate INTO v_truck_number
    FROM trucks
   WHERE id = v_truck_id;

  UPDATE load_bids
    SET status = 'accepted', updated_at = now()
    WHERE id = p_bid_id;

  UPDATE load_bids
    SET status = 'rejected', updated_at = now()
    WHERE load_id = v_load_id
      AND id != p_bid_id;

  UPDATE load_offers
    SET status = 'claimed', updated_at = now()
    WHERE id = v_load_id;

  UPDATE orders
    SET driver_id          = v_driver_id,
        truck_id           = v_truck_id,
        status             = 'truck_assigned',
        driver_name        = v_driver_name,
        driver_rating      = v_driver_rating,
        truck_number       = v_truck_number,
        total_amount       = v_bid_amount,
        bid_amount         = v_bid_amount,
        escrow_booking_id  = COALESCE(p_escrow_booking_id, escrow_booking_id),
        pending_bid_acceptance = NULL,
        version            = version + 1,
        updated_at         = now()
    WHERE order_display_id = v_order_display_id;

  UPDATE order_timeline
    SET completed      = true,
        milestone_time = now()
    WHERE order_display_id = v_order_display_id
      AND milestone = 'Truck Assigned';

  -- Durable outbox event, committed with the order (same transaction).
  PERFORM public.add_order_outbox_event(
    v_order_id,
    v_order_display_id,
    'DRIVER_ASSIGNED',
    jsonb_build_object(
      'orderId',          v_order_id::text,
      'order_id',         v_order_id::text,
      'order_display_id', v_order_display_id,
      'status',           'truck_assigned',
      'driver_id',        v_driver_id::text,
      'driver_name',      v_driver_name,
      'driver_rating',    v_driver_rating,
      'truck_id',         v_truck_id::text,
      'truck_number',     v_truck_number,
      'bid_amount',       v_bid_amount
    )
  );
END;
$$;

-- 6e. complete_trip_tx (trip completion / payment release)
CREATE OR REPLACE FUNCTION complete_trip_tx(
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

  -- OTP validation. service_role (release reconciliation) may skip the OTP.
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

  -- Fail closed: credit the driver wallet ONLY when the escrow was actually
  -- funded and released on-chain, or when the order is escrow_disabled.
  if not v_order.escrow_disabled
     and coalesce(v_order.escrow_status, '') <> 'released'
     and p_release_tx_hash is null then
    raise exception 'Blockchain escrow release must complete before crediting driver wallet';
  end if;

  -- Finalize the active trip that actually served THIS order.
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

  -- Update order status and escrow details.
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

  -- Update driver's wallet (bid_amount payout basis)
  update driver_details
  set
    total_trips = total_trips + 1,
    wallet_confirmed = wallet_confirmed + coalesce(v_order.bid_amount, v_order.total_amount),
    wallet_total = wallet_total + coalesce(v_order.bid_amount, v_order.total_amount),
    updated_at = now()
  where user_id = v_order.driver_id;

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
  insert into earnings_daily (driver_id, day_date, amount, trip_count)
  values (v_order.driver_id, current_date, coalesce(v_order.bid_amount, v_order.total_amount), 1)
  on conflict (driver_id, day_date)
  do update set
    amount = earnings_daily.amount + excluded.amount,
    trip_count = earnings_daily.trip_count + 1;

  -- Durable outbox event, committed with the order (same transaction).
  PERFORM public.add_order_outbox_event(
    p_order_id,
    v_order.order_display_id,
    'PAYMENT_RELEASED',
    jsonb_build_object(
      'orderId',          p_order_id::text,
      'order_id',         p_order_id::text,
      'order_display_id', v_order.order_display_id,
      'status',           'payment_released',
      'driver_id',        v_order.driver_id::text,
      'total_amount',     coalesce(v_order.bid_amount, v_order.total_amount),
      'release_tx_hash',  p_release_tx_hash
    )
  );

  driver_id := v_order.driver_id;
  return next;
end;
$$;

-- 6f. cancel_stale_order_tx (stale-order worker)
CREATE OR REPLACE FUNCTION public.cancel_stale_order_tx(
  p_order_id            UUID,
  p_cancellation_reason TEXT,
  p_stale_since         TIMESTAMPTZ
)
RETURNS SETOF orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  -- SECURITY DEFINER bypasses RLS, so only the backend (service_role) may run
  -- this. The owning-customer path is covered by update_order_status_tx instead.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only the backend service can cancel stale orders';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN;
  END IF;

  IF v_order.status <> 'pending' OR v_order.created_at >= p_stale_since THEN
    RETURN;
  END IF;

  -- Two-phase acceptance in flight: the escrow-funding reconciliation worker
  -- owns the funding -> healed/reverted transition. Never cancel here.
  IF v_order.escrow_status = 'funding' THEN
    RETURN;
  END IF;

  -- Escrow involvement: place the order into refund reconciliation.
  IF v_order.escrow_status IN ('funded', 'refund_pending', 'refund_failed') THEN
    UPDATE orders
       SET status                   = 'cancelled',
           cancellation_reason      = COALESCE(p_cancellation_reason, v_order.cancellation_reason),
           escrow_status            = 'refund_pending',
           escrow_refund_error      = NULL,
           escrow_refund_attempts   = COALESCE(v_order.escrow_refund_attempts, 0) + 1,
           escrow_refund_last_attempt_at = NOW(),
           updated_at               = NOW()
     WHERE id = p_order_id
       AND status = 'pending'
     RETURNING * INTO v_order;

    IF v_order.id IS NOT NULL THEN
      PERFORM public.add_order_outbox_event(
        v_order.id,
        v_order.order_display_id,
        'ORDER_CANCELLED',
        jsonb_build_object(
          'orderId',          v_order.id::text,
          'order_id',         v_order.id::text,
          'order_display_id', v_order.order_display_id,
          'status',           'cancelled',
          'escrow_status',    'refund_pending',
          'cancellation_reason', v_order.cancellation_reason
        )
      );
      RETURN NEXT v_order;
    END IF;
    RETURN;
  END IF;

  -- Plain cancellation: no escrow involvement.
  UPDATE orders
     SET status              = 'cancelled',
         cancellation_reason = COALESCE(p_cancellation_reason, v_order.cancellation_reason),
         updated_at          = NOW()
   WHERE id = p_order_id
     AND status = 'pending'
   RETURNING * INTO v_order;

  IF v_order.id IS NOT NULL THEN
    PERFORM public.add_order_outbox_event(
      v_order.id,
      v_order.order_display_id,
      'ORDER_CANCELLED',
      jsonb_build_object(
        'orderId',          v_order.id::text,
        'order_id',         v_order.id::text,
        'order_display_id', v_order.order_display_id,
        'status',           'cancelled',
        'cancellation_reason', v_order.cancellation_reason
      )
    );
    RETURN NEXT v_order;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_stale_order_tx(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_stale_order_tx(UUID, TEXT, TIMESTAMPTZ) TO service_role;

COMMIT;
