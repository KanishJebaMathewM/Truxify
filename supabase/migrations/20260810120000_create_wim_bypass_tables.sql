-- ============================================================================
-- WIM BYPASS — Trusted measurements + durable bypass credentials
-- ============================================================================
-- Backs backend/api/src/routes/wimBypass.js and
-- backend/api/src/services/wimBypass.js.
--
-- TRUST MODEL:
--   A "WIM measurement" is a server-derived snapshot of authoritative records
--   (truck registered capacity, load registered weight, driver verified
--   registration). It is recorded here so issuance is auditable and so the
--   same measurement can never authorize a different vehicle/load.
--
--   A "bypass credential" is the short-lived, single-use artifact presented
--   downstream. credential_id is a unique nonce: durable storage + an atomic
--   consumed_at flip provide replay protection that never relies on in-memory
--   state.
--
-- SECURITY MODEL:
--   Both tables are written only by the backend (service_role) and never read
--   by clients, mirroring trace_* conventions.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. TRUSTED WIM MEASUREMENTS
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists wim_measurements (
  id                uuid primary key default gen_random_uuid(),
  measurement_nonce text not null unique,           -- unique nonce per snapshot
  truck_id          uuid not null,
  order_display_id  text not null,
  driver_id         uuid not null,
  weight_lbs        numeric not null,               -- server-derived load weight
  capacity_lbs      numeric not null,               -- server-derived truck capacity
  safety_score      integer not null,               -- server-derived safety signal
  source            text not null default 'server-derived',
  measured_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index if not exists idx_wim_measurements_truck
  on wim_measurements (truck_id, measured_at desc);
create index if not exists idx_wim_measurements_order
  on wim_measurements (order_display_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. BYPASS CREDENTIALS (durable, replay-protected)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists wim_bypass_credentials (
  id               uuid primary key default gen_random_uuid(),
  credential_id    text not null unique,            -- unique nonce, never reused
  measurement_id   uuid not null references wim_measurements(id),
  driver_id        uuid not null,
  truck_id         uuid not null,
  order_display_id text not null,
  safety_score     integer not null,
  axle_weight_lbs  numeric not null,
  eligible         boolean not null,
  issued_at        timestamptz not null default now(),
  expires_at       timestamptz not null,
  consumed_at      timestamptz,
  status           text not null default 'issued'
    check (status in ('issued', 'consumed', 'expired', 'revoked')),
  created_at       timestamptz not null default now()
);

create index if not exists idx_wim_credentials_measurement
  on wim_bypass_credentials (measurement_id);
create index if not exists idx_wim_credentials_driver
  on wim_bypass_credentials (driver_id, issued_at desc);
create index if not exists idx_wim_credentials_expiry
  on wim_bypass_credentials (expires_at);
create index if not exists idx_wim_credentials_status
  on wim_bypass_credentials (status);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table wim_measurements enable row level security;
alter table wim_bypass_credentials enable row level security;

drop policy if exists "Service role full access on wim_measurements"
  on wim_measurements;
create policy "Service role full access on wim_measurements"
  on wim_measurements
  for all to service_role
  using (true)
  with check (true);

drop policy if exists "Service role full access on wim_bypass_credentials"
  on wim_bypass_credentials;
create policy "Service role full access on wim_bypass_credentials"
  on wim_bypass_credentials
  for all to service_role
  using (true)
  with check (true);

revoke all on table wim_measurements from anon, authenticated;
revoke all on table wim_bypass_credentials from anon, authenticated;
