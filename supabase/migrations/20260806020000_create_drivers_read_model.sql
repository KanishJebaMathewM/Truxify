-- ============================================================================
-- EVENT SOURCING — Driver Read-Model Table
-- ============================================================================
-- The eventsourcing projection (backend/eventsourcing/event-store.js
-- updateDriverReadModel) upserts driver read models into `drivers_read_model`
-- for every DRIVER_ASSIGNED event. No migration or setup SQL ever created this
-- table, so the upsert failed with `relation "drivers_read_model" does not
-- exist` and the error was only logged — the driver-projection data was never
-- persisted. This migration creates the table with columns matching the insert
-- in event-store.js.
--
-- SECURITY MODEL:
--   - Written by backend services and never exposed to clients, so RLS allows
--     service_role only.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. DRIVER READ-MODEL TABLE
-- ────────────────────────────────────────────────────────────────────────────
-- driver_id is the natural upsert key (updateDriverReadModel uses onConflict:
-- 'driver_id').
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists drivers_read_model (
  driver_id   text not null,          -- event.payload.driverId
  order_id    text,                   -- event.payload.orderId
  assigned_at timestamptz,            -- event.payload.assignedAt
  updated_at  timestamptz not null default now(),
  primary key (driver_id)
);

create index if not exists idx_drivers_read_model_order
  on drivers_read_model (order_id);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table drivers_read_model enable row level security;

drop policy if exists "Service role full access on drivers_read_model"
  on drivers_read_model;
create policy "Service role full access on drivers_read_model"
  on drivers_read_model
  for all to service_role
  using (true)
  with check (true);

revoke all on table drivers_read_model from anon, authenticated;
