-- ============================================================================
-- UNIFIED EVENT-SOURCING PIPELINE — Durable Transactional Outbox
-- ============================================================================
-- Resolves Issue #1: the repository previously ran two disconnected
-- event-sourcing/CQRS systems (backend/eventsourcing writing `event_store` +
-- `orders_read_model`, backend/kafka writing `events` + `order_read_models`),
-- while the canonical order mutation path wrote directly to `orders` and never
-- durably recorded events.
--
-- THIS migration establishes the ONE authoritative pipeline:
--
--   ORDER MUTATION
--       |
--       v
--   DATABASE TRANSACTION   (trigger on `orders`, same transaction)
--       |-- update orders
--       `-- insert durable outbox event  (event_outbox)
--       v
--   COMMIT
--       v
--   OUTBOX RELAY   (backend/kafka/relay/outbox.relay.js)
--       v
--   KAFKA
--       v
--   CONSUMER   (backend/kafka/consumers/order.consumer.js)
--       v
--   SINGLE READ MODEL   (`orders_read_model`, applied atomically with the
--                        `kafka_processed_events` idempotency record)
--
-- Tables created here:
--   * event_outbox           — the durable, transactional event log (outbox).
--   * orders_read_model      — already exists (20260806010000); reused as the
--                              single authoritative order read model.
--
-- RPC functions created here:
--   * enqueue_order_event()  — trigger function that writes the outbox row in
--                              the SAME transaction as the order mutation, so
--                              a failure on either side rolls both back.
--   * claim_outbox_events()  — atomically claims pending outbox rows for the
--                              relay (FOR UPDATE SKIP LOCKED), multi-worker safe.
--   * mark_outbox_published()/fail_outbox_events() — relay bookkeeping.
--   * apply_order_event()    — atomically applies a consumed event to
--                              `orders_read_model` AND records it in
--                              `kafka_processed_events` (idempotent).
--   * backfill_order_events()— idempotent backfill of the read model from the
--                              authoritative `orders` table + outbox priming.
--
-- SECURITY MODEL: all tables/functions are written by backend services with
-- the service-role key and never exposed to clients, so RLS allows
-- service_role only. The trigger and RPCs are SECURITY DEFINER so they run as
-- the function owner regardless of the caller that mutated the order.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. EVENT OUTBOX TABLE (the durable event log)
-- ────────────────────────────────────────────────────────────────────────────
-- `event_id` and `aggregate_id` are DISTINCT concepts on purpose:
--   * event_id     — the natural event identifier (uuid), used as the Kafka
--                    message idempotency key.
--   * aggregate_id — the REAL order id (orders.id), used as the Kafka message
--                    key and as the read-model primary key.
-- A bug in the legacy Kafka envelope used event.eventId as the order id; the
-- relay that reads this table always uses `aggregate_id` for the order.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists event_outbox (
  event_id        text        primary key,
  aggregate_id    text        not null,
  event_type      text        not null,
  payload         jsonb       not null default '{}'::jsonb,
  version         bigint,
  status          text        not null default 'pending',
  attempts        integer     not null default 0,
  last_error      text,
  next_attempt_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  published_at    timestamptz,
  constraint event_outbox_status_check check (status in ('pending', 'publishing', 'published'))
);

create index if not exists idx_event_outbox_dispatch
  on event_outbox (status, next_attempt_at);

create index if not exists idx_event_outbox_aggregate
  on event_outbox (aggregate_id);

create index if not exists idx_event_outbox_created
  on event_outbox (created_at);

alter table event_outbox enable row level security;

drop policy if exists "Service role full access on event_outbox" on event_outbox;
create policy "Service role full access on event_outbox"
  on event_outbox
  for all to service_role
  using (true)
  with check (true);

revoke all on table event_outbox from anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. ORDER EVENT ENQUEUE TRIGGER
-- ────────────────────────────────────────────────────────────────────────────
-- Every important order state transition is captured as a durable outbox event
-- inside the SAME transaction as the order mutation:
--   * INSERT                        -> ORDER_CREATED
--   * status -> 'cancelled'         -> ORDER_CANCELLED
--   * driver_id changed             -> DRIVER_ASSIGNED
--   * any other status change       -> ORDER_UPDATED
--   * internal bookkeeping writes   -> no event (escrow retries, hashes, ...)
--
-- SECURITY DEFINER so the event insert is never blocked by RLS, regardless of
-- whether the order was mutated by a service-role repository call, a SECURITY
-- DEFINER RPC (create_order_tx / complete_trip_tx / ...) or a worker.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.enqueue_order_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_type text;
  v_next_version bigint;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'ORDER_CREATED';
  else
    if NEW.status = 'cancelled' then
      v_event_type := 'ORDER_CANCELLED';
    elsif OLD.driver_id is distinct from NEW.driver_id then
      v_event_type := 'DRIVER_ASSIGNED';
    elsif OLD.status is distinct from NEW.status then
      v_event_type := 'ORDER_UPDATED';
    else
      -- Internal bookkeeping update (escrow attempts, tx hashes, otp state...),
      -- not an order state transition. No event.
      return NEW;
    end if;
  end if;

  select coalesce(max(version), 0) + 1
    into v_next_version
    from event_outbox
    where aggregate_id = NEW.id::text;

  insert into event_outbox (event_id, aggregate_id, event_type, payload, version, status)
  values (
    gen_random_uuid()::text,
    NEW.id::text,
    v_event_type,
    to_jsonb(NEW),
    v_next_version,
    'pending'
  );

  return NEW;
end;
$$;

drop trigger if exists trg_orders_event_outbox on orders;
create trigger trg_orders_event_outbox
after insert or update on orders
for each row
execute function public.enqueue_order_event();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. OUTBOX RELAY CLAIM / BOOKKEEPING RPCs
-- ────────────────────────────────────────────────────────────────────────────
-- claim_outbox_events atomically moves pending rows to 'publishing' and claims
-- them with FOR UPDATE SKIP LOCKED, so multiple relay workers can poll the
-- same table without double-publishing. A row claimed by a crashed worker is
-- reclaimed once its next_attempt_at (set at claim time) elapses — Kafka
-- at-least-once + the consumer idempotency record make replays harmless.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.claim_outbox_events(p_limit integer default 100)
returns setof event_outbox
language sql
security definer
set search_path = public, pg_temp
as $$
  update event_outbox
     set status = 'publishing',
         attempts = attempts + 1,
         next_attempt_at = now() + interval '1 minute',
         last_error = null
   where event_id in (
     select event_id
       from event_outbox
      where status = 'pending'
         or (status = 'publishing' and next_attempt_at <= now())
      order by created_at
      limit p_limit
      for update skip locked
   )
  returning *;
$$;

create or replace function public.mark_outbox_published(p_event_ids text[])
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update event_outbox
     set status = 'published',
         published_at = now(),
         last_error = null
   where event_id = any(p_event_ids)
     and status = 'publishing';
$$;

create or replace function public.fail_outbox_events(
  p_event_ids text[],
  p_error text,
  p_retry_after interval default interval '1 minute'
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update event_outbox
     set status = 'pending',
         last_error = left(p_error, 500),
         next_attempt_at = now() + p_retry_after
   where event_id = any(p_event_ids)
     and status = 'publishing';
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. ATOMIC READ-MODEL APPLY
-- ────────────────────────────────────────────────────────────────────────────
-- Consumed Kafka messages update the SINGLE authoritative order read model
-- (`orders_read_model`) and record idempotency in `kafka_processed_events`
-- inside ONE transaction. An event is never marked processed before its
-- read-model update succeeds, and a duplicate/replayed message is a no-op.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.apply_order_event(
  p_order_id text,
  p_payload jsonb,
  p_event_type text,
  p_version bigint,
  p_topic text,
  p_event_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_applied boolean;
begin
  insert into kafka_processed_events (topic, event_id, order_id)
  values (p_topic, p_event_id, nullif(p_order_id, '')::uuid)
  on conflict (topic, event_id) do nothing
  returning true into v_applied;

  if v_applied then
    insert into orders_read_model (order_id, payload, event_type, version, updated_at)
    values (p_order_id, p_payload, p_event_type, p_version, now())
    on conflict (order_id) do update
    set payload     = excluded.payload,
        event_type  = excluded.event_type,
        version     = coalesce(excluded.version, orders_read_model.version),
        updated_at  = now();
  end if;

  return jsonb_build_object('applied', coalesce(v_applied, false));
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. IDEMPOTENT BACKFILL / REBUILD
-- ────────────────────────────────────────────────────────────────────────────
-- Safe to re-run. Historical events for pre-existing orders cannot be
-- reconstructed (they were never recorded), so the read model is backfilled
-- from the authoritative `orders` table; aggregates that already have outbox
-- events are left untouched. Orders that never had an event get ONE outbox
-- event so they also flow through Kafka once (documented limitation: this
-- event reflects the current row, not the original creation event).
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.backfill_order_events()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_order_count bigint := 0;
  v_rm_count bigint := 0;
  v_event_count bigint := 0;
  v_event_type text;
begin
  for v_row in select * from orders order by created_at loop
    v_order_count := v_order_count + 1;

    -- 1. Initial read-model backfill straight from the authoritative table.
    insert into orders_read_model (order_id, payload, event_type, version, updated_at)
    values (v_row.id::text, to_jsonb(v_row), 'ORDER_CREATED', v_row.version, now())
    on conflict (order_id) do update
    set payload    = excluded.payload,
        event_type = excluded.event_type,
        version    = coalesce(excluded.version, orders_read_model.version),
        updated_at = now();

    v_rm_count := v_rm_count + 1;

    -- 2. Prime the pipeline only for aggregates that never had an event.
    if not exists (select 1 from event_outbox e where e.aggregate_id = v_row.id::text) then
      if v_row.status = 'cancelled' then
        v_event_type := 'ORDER_CANCELLED';
      elsif v_row.driver_id is not null then
        v_event_type := 'DRIVER_ASSIGNED';
      elsif v_row.status = 'pending' then
        v_event_type := 'ORDER_CREATED';
      else
        v_event_type := 'ORDER_UPDATED';
      end if;

      insert into event_outbox (event_id, aggregate_id, event_type, payload, version, status)
      values (gen_random_uuid()::text, v_row.id::text, v_event_type, to_jsonb(v_row), 1, 'pending');

      v_event_count := v_event_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'orders', v_order_count,
    'read_models_written', v_rm_count,
    'outbox_events_enqueued', v_event_count
  );
end;
$$;
