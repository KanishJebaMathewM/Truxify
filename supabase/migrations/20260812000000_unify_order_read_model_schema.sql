-- ============================================================================
-- UNIFY ORDER READ-MODEL SCHEMA — single authoritative `orders_read_model`
-- ============================================================================
-- Consolidates the two divergent order read-model tables created by
-- 20260806010000_create_orders_read_model.sql (orders_read_model) and
-- 20260805090000_create_kafka_event_tables.sql (order_read_models) into ONE
-- canonical table.
--
-- CANONICAL SCHEMA — `orders_read_model` (union of the base table created by
-- 20260806010000 and the columns added by this migration):
--
--   order_id   text primary key,   -- base column (20260806010000)
--   payload    jsonb,              -- base column — full order state
--   event_type text,               -- base column — last event type
--   version    integer,            -- base column — last aggregate version
--   updated_at timestamptz,        -- base column — last write time
--   status     text,               -- ADDED HERE — normalized status (lowercase)
--   timeline   jsonb               -- ADDED HERE — ordered event timeline
--
-- The schema module backend/api/src/core/orders/read-model-schema.js is the
-- single source of truth; the drift test parses BOTH migrations and compares
-- the union against ORDER_READ_MODEL_COLUMNS.
--
-- Column mapping from the obsolete `order_read_models` table:
--   order_id   -> order_id
--   data       -> payload
--   status     -> status
--   timeline   -> timeline
--   updated_at -> updated_at
--   event_type is derived from the last timeline entry's type
--   version    is derived from the number of timeline entries
--
-- This migration:
--   1. adds the canonical columns to `orders_read_model` (idempotent — a no-op
--      after the 20260806010000 migration, which created the base table),
--   2. adds required indexes,
--   3. backfills `status` for rows written before this column existed,
--   4. backfills `orders_read_model` from `order_read_models` for order_ids
--      that do not yet exist there (non-destructive, idempotent, safe to
--      re-run),
--   5. marks `order_read_models` as deprecated. It is intentionally NOT
--      dropped: it may hold historical data that operators want to keep, and
--      no production code references it after this change.
--
-- The table is deliberately NOT re-created here: `orders_read_model` is owned
-- by 20260806010000_create_orders_read_model.sql (which also set up its
-- service_role-only RLS policy). This migration only alters that table.
--
-- SECURITY MODEL: unchanged — `orders_read_model` remains service_role only
-- (RLS policy created by 20260806010000_create_orders_read_model.sql).
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. ADD CANONICAL COLUMNS (idempotent; no-op when already present)
-- ────────────────────────────────────────────────────────────────────────────
alter table orders_read_model
  add column if not exists status text,
  add column if not exists timeline jsonb;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. REQUIRED INDEXES
-- ────────────────────────────────────────────────────────────────────────────
create index if not exists idx_orders_read_model_status
  on orders_read_model (status);

create index if not exists idx_orders_read_model_updated
  on orders_read_model (updated_at);


-- ────────────────────────────────────────────────────────────────────────────
-- 3. BACKFILL status FOR ROWS WRITTEN BEFORE THE COLUMN EXISTED
-- ────────────────────────────────────────────────────────────────────────────
-- The eventsourcing projection stored the aggregate state in `payload` with an
-- uppercase status (CREATED / ASSIGNED / CANCELLED). The canonical `status`
-- column stores the normalized lowercase form so `status`-column filters work
-- identically for rows produced by either projection.
update orders_read_model
  set status = lower(nullif(btrim(coalesce(payload ->> 'status', '')), ''))
  where status is null
    and payload is not null
    and payload ? 'status';

update orders_read_model
  set status = 'created'
  where status is null
    and payload is not null
    and not (payload ? 'status');


-- ────────────────────────────────────────────────────────────────────────────
-- 4. BACKFILL FROM THE OBSOLETE order_read_models TABLE
-- ────────────────────────────────────────────────────────────────────────────
-- Copies every order present only in `order_read_models` into the canonical
-- table, mapping the old columns onto the canonical shape. Rows that already
-- exist in `orders_read_model` are left untouched (the canonical row wins).
-- Guarded by to_regclass so environments that never created the obsolete table
-- (e.g. fresh databases created after consolidation) do not fail the run.
do $$
begin
  if to_regclass('public.order_read_models') is not null then
    insert into orders_read_model (order_id, payload, event_type, version, status, timeline, updated_at)
    select
      s.order_id,
      s.data,
      nullif(s.timeline -> -1 ->> 'type', ''),
      jsonb_array_length(coalesce(s.timeline, '[]'::jsonb)),
      lower(nullif(btrim(coalesce(s.status, 'created')), '')),
      s.timeline,
      coalesce(s.updated_at, now())
    from order_read_models s
    where not exists (
      select 1 from orders_read_model t
      where t.order_id = s.order_id
    )
    on conflict (order_id) do nothing;
  end if;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. DOCUMENT THE CANONICAL TABLE AND DEPRECATE THE OBSOLETE ONE
-- ────────────────────────────────────────────────────────────────────────────
comment on table orders_read_model is
  'CANONICAL order read model. Single source of truth for order projections; '
  'written by backend/eventsourcing (event-store.js) and backend/kafka '
  '(cqrs/order.read.model.js). Schema source of truth: '
  'backend/api/src/core/orders/read-model-schema.js';

comment on table order_read_models is
  'DEPRECATED. Superseded by orders_read_model (see migration '
  '20260812000000_unify_order_read_model_schema.sql). Kept only as historical '
  'data; no production code reads or writes this table. Existing rows were '
  'backfilled into orders_read_model.';
