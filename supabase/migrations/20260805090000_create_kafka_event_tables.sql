-- ============================================================================
-- KAFKA EVENT SOURCING — Event Store & CQRS Read-Model Tables
-- ============================================================================
-- The Kafka event-driven service (backend/kafka) persists domain events in
-- `events` and maintains a denormalized CQRS read model in
-- `order_read_models`.  Neither table was created by any migration, so every
-- query failed with "relation does not exist".  This migration creates both
-- tables with columns matching the inserts in event.repository.js and
-- order.read.model.js.
--
-- SECURITY MODEL:
--   - Both tables are written by backend services using the service_role key
--     and are never exposed to clients, so RLS allows service_role only.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. EVENT STORE TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists events (
  event_id    text not null,          -- event.eventId (natural key)
  event_type  text not null,          -- event.eventType
  order_id    text,                   -- event.orderId
  data        jsonb,                  -- event.data
  metadata    jsonb,                  -- event.metadata
  timestamp   timestamptz not null default now(),
  primary key (event_id)
);

create index if not exists idx_events_order
  on events (order_id);

create index if not exists idx_events_type
  on events (event_type);

create index if not exists idx_events_timestamp
  on events (timestamp);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. CQRS ORDER READ-MODEL TABLE
-- ────────────────────────────────────────────────────────────────────────────
-- order_id is the natural upsert key (updateReadModel uses onConflict:
-- 'order_id').
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists order_read_models (
  order_id   text not null,           -- snapshot.orderId
  status     text not null default 'created',
  data       jsonb,                   -- snapshot.data
  timeline   jsonb,                   -- snapshot.timeline
  updated_at timestamptz not null default now(),
  primary key (order_id)
);

create index if not exists idx_order_read_models_status
  on order_read_models (status);

create index if not exists idx_order_read_models_updated
  on order_read_models (updated_at);


-- ────────────────────────────────────────────────────────────────────────────
-- 3. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table events enable row level security;
alter table order_read_models enable row level security;

drop policy if exists "Service role full access on events" on events;
create policy "Service role full access on events"
  on events
  for all to service_role
  using (true)
  with check (true);

drop policy if exists "Service role full access on order_read_models"
  on order_read_models;
create policy "Service role full access on order_read_models"
  on order_read_models
  for all to service_role
  using (true)
  with check (true);

revoke all on table events from anon, authenticated;
revoke all on table order_read_models from anon, authenticated;
