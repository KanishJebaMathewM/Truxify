-- ============================================================================
-- EVENT SOURCING — Event Store Table
-- ============================================================================
-- The eventsourcing module (backend/eventsourcing) persists every domain event
-- in `event_store` and reads it back for event streams, aggregate-state
-- rebuilds and projection rebuilds (storeEvent / getEventStream in
-- event-store.js, plus the POST /eventsourcing/rebuild endpoint in routes.js).
-- No migration ever created the table, so storeEvent threw
-- `relation "event_store" does not exist`, handleCommand always failed,
-- getEventStream returned [] and rebuild returned 500. This migration creates
-- the table with columns matching the inserts in event-store.js.
--
-- SECURITY MODEL:
--   - Written by backend services and never exposed to clients, so RLS allows
--     service_role only.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. EVENT STORE TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists event_store (
  event_id     text not null,          -- event.id (natural key)
  event_type   text not null,          -- event.type
  aggregate_id text not null,          -- event.aggregateId
  payload      jsonb,                  -- event.payload
  version      integer,                -- event.version
  timestamp    timestamptz not null,   -- event.timestamp
  created_at   timestamptz not null default now(),
  primary key (event_id)
);

create index if not exists idx_event_store_aggregate
  on event_store (aggregate_id);

create index if not exists idx_event_store_timestamp
  on event_store (timestamp);

create index if not exists idx_event_store_aggregate_version
  on event_store (aggregate_id, version);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table event_store enable row level security;

drop policy if exists "Service role full access on event_store"
  on event_store;
create policy "Service role full access on event_store"
  on event_store
  for all to service_role
  using (true)
  with check (true);

revoke all on table event_store from anon, authenticated;
