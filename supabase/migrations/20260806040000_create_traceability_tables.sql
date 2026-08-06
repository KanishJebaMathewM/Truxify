-- ============================================================================
-- TRACEABILITY — Product / Shipment / Event / Verification Tables
-- ============================================================================
-- The traceability module (backend/traceability/trace.service.js) persists
-- supply-chain trace records into `trace_products`, `trace_shipments`,
-- `trace_events` and `trace_verifications`, and reads them back for the stats
-- endpoint. No migration or setup SQL ever created any of them, so every
-- operation failed with `relation ... does not exist` and the entire
-- traceability write path could never persist a single record. This migration
-- creates all four tables with columns matching the inserts in
-- trace.service.js.
--
-- SECURITY MODEL:
--   - Written by backend services and never exposed to clients, so RLS allows
--     service_role only.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. TRACE PRODUCTS
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists trace_products (
  product_id   text not null,         -- storeProduct: data.productId
  name         text,                  -- data.name
  description  text,                  -- data.description
  category     text,                  -- data.category
  metadata_uri text,                  -- data.metadataURI
  tx_hash      text,                  -- data.txHash
  created_at   timestamptz not null default now(),
  primary key (product_id)
);

create index if not exists idx_trace_products_created
  on trace_products (created_at);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. TRACE SHIPMENTS
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists trace_shipments (
  shipment_id      text not null,     -- storeShipment: data.shipmentId
  product_id       text,              -- data.productId
  receiver         text,              -- data.receiver
  location         text,              -- data.location
  status           text,              -- 'CREATED' | 'DELIVERED' | ...
  tx_hash          text,              -- data.txHash
  updated_tx_hash  text,              -- updateShipmentInDB: txHash
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,
  primary key (shipment_id)
);

create index if not exists idx_trace_shipments_product
  on trace_shipments (product_id);


-- ────────────────────────────────────────────────────────────────────────────
-- 3. TRACE EVENTS
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists trace_events (
  id          bigint generated always as identity primary key,
  product_id  text not null,          -- storeEvent: data.productId
  event_type  text,                   -- data.eventType
  location    text,                   -- data.location
  description text,                   -- data.description
  tx_hash     text,                   -- data.txHash
  created_at  timestamptz not null default now()
);

create index if not exists idx_trace_events_product
  on trace_events (product_id);


-- ────────────────────────────────────────────────────────────────────────────
-- 4. TRACE VERIFICATIONS
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists trace_verifications (
  id          bigint generated always as identity primary key,
  product_id  text not null,          -- storeVerification: data.productId
  is_valid    boolean,                -- data.isValid
  notes       text,                   -- data.notes
  tx_hash     text,                   -- data.txHash
  created_at  timestamptz not null default now()
);

create index if not exists idx_trace_verifications_product
  on trace_verifications (product_id);


-- ────────────────────────────────────────────────────────────────────────────
-- 5. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table trace_products enable row level security;
alter table trace_shipments enable row level security;
alter table trace_events enable row level security;
alter table trace_verifications enable row level security;

drop policy if exists "Service role full access on trace_products"
  on trace_products;
create policy "Service role full access on trace_products"
  on trace_products
  for all to service_role
  using (true)
  with check (true);

drop policy if exists "Service role full access on trace_shipments"
  on trace_shipments;
create policy "Service role full access on trace_shipments"
  on trace_shipments
  for all to service_role
  using (true)
  with check (true);

drop policy if exists "Service role full access on trace_events"
  on trace_events;
create policy "Service role full access on trace_events"
  on trace_events
  for all to service_role
  using (true)
  with check (true);

drop policy if exists "Service role full access on trace_verifications"
  on trace_verifications;
create policy "Service role full access on trace_verifications"
  on trace_verifications
  for all to service_role
  using (true)
  with check (true);

revoke all on table trace_products from anon, authenticated;
revoke all on table trace_shipments from anon, authenticated;
revoke all on table trace_events from anon, authenticated;
revoke all on table trace_verifications from anon, authenticated;
