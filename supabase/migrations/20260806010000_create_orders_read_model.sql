-- ============================================================================
-- EVENT SOURCING — Order Read-Model Table
-- ============================================================================
-- The eventsourcing projection (backend/eventsourcing/event-store.js
-- updateOrderReadModel) upserts order read models into `orders_read_model`
-- for every ORDER_CREATED / ORDER_UPDATED / ORDER_CANCELLED / DRIVER_ASSIGNED
-- event, and getOrderReadModel / getOrderList read it back. No migration ever
-- created this table — the only read-model DDL in the repo is
-- `order_read_models` (singular prefix), a different table used by the kafka
-- CQRS module — so every projection upsert failed with
-- `relation "orders_read_model" does not exist` and the error was only logged,
-- leaving projections silently empty. This migration creates the table with
-- columns matching the insert in event-store.js.
--
-- SECURITY MODEL:
--   - Written by backend services and never exposed to clients, so RLS allows
--     service_role only.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. ORDER READ-MODEL TABLE
-- ────────────────────────────────────────────────────────────────────────────
-- order_id is the natural upsert key (updateOrderReadModel uses onConflict:
-- 'order_id').
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists orders_read_model (
  order_id   text not null,           -- event.aggregateId
  payload    jsonb,                   -- event.payload
  event_type text,                    -- event.type
  version    integer,                 -- event.version
  updated_at timestamptz not null default now(),
  primary key (order_id)
);

create index if not exists idx_orders_read_model_updated
  on orders_read_model (updated_at);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table orders_read_model enable row level security;

drop policy if exists "Service role full access on orders_read_model"
  on orders_read_model;
create policy "Service role full access on orders_read_model"
  on orders_read_model
  for all to service_role
  using (true)
  with check (true);

revoke all on table orders_read_model from anon, authenticated;
