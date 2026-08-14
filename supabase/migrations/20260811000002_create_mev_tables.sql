-- ============================================================================
-- MEV PROTECTION — Commitment / Escrow / Flashbots Bundle Tables
-- ============================================================================
-- The MEV module (backend/mev/mev.service.js) persists commitments, MEV
-- protected escrows and Flashbots bundle submissions into `mev_commitments`,
-- `mev_escrows` and `flashbots_bundles`, and reads them back for stats. No
-- migration previously created any of them, so every operation failed with
-- `relation ... does not exist`. This migration creates all three tables with
-- columns matching the inserts, updates and selects in mev.service.js.
--
-- SECURITY MODEL:
--   - Written by backend services using service_role credentials and never
--     exposed directly to clients, so RLS allows service_role only.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. MEV COMMITMENTS TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists mev_commitments (
  id          bigint generated always as identity primary key,
  user_id     text,                      -- storeCommitment: data.userId
  secret_hash text,                      -- storeCommitment: data.secretHash
  tx_hash     text,                      -- storeCommitment: data.txHash
  created_at  timestamptz not null default now()
);

create index if not exists idx_mev_commitments_user_id
  on mev_commitments (user_id);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. MEV ESCROWS TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists mev_escrows (
  escrow_id         text not null,       -- storeEscrow: data.escrowId
  customer          text,                -- storeEscrow: data.customer
  driver            text,                -- storeEscrow: data.driver
  amount            text,                -- storeEscrow: data.amount
  commit_hash       text,                -- storeEscrow: data.commitHash
  secret_hash       text,                -- storeEscrow: data.secretHash
  tx_hash           text,                -- storeEscrow: data.txHash
  status            text not null default 'pending', -- storeEscrow: status / updateEscrowStatus
  released_tx_hash  text,                -- updateEscrowStatus: released_tx_hash
  released_at       timestamptz,         -- updateEscrowStatus: released_at
  created_at        timestamptz not null default now(),
  primary key (escrow_id)
);

create index if not exists idx_mev_escrows_driver
  on mev_escrows (driver);

create index if not exists idx_mev_escrows_status
  on mev_escrows (status);


-- ────────────────────────────────────────────────────────────────────────────
-- 3. FLASHBOTS BUNDLES TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists flashbots_bundles (
  id           bigint generated always as identity primary key,
  escrow_id    text,                     -- storeBundle: data.escrowId
  bundle_id    text,                     -- storeBundle: data.bundleId
  block_number text,                     -- storeBundle: data.blockNumber
  submitted_at timestamptz not null default now(), -- storeBundle: submitted_at
  constraint fk_flashbots_bundles_escrow
    foreign key (escrow_id)
    references mev_escrows (escrow_id)
    on delete set null
);

create index if not exists idx_flashbots_bundles_escrow_id
  on flashbots_bundles (escrow_id);


-- ────────────────────────────────────────────────────────────────────────────
-- 4. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table mev_commitments enable row level security;
alter table mev_escrows enable row level security;
alter table flashbots_bundles enable row level security;

drop policy if exists "Service role full access on mev_commitments" on mev_commitments;
create policy "Service role full access on mev_commitments"
  on mev_commitments
  for all to service_role
  using (true)
  with check (true);

drop policy if exists "Service role full access on mev_escrows" on mev_escrows;
create policy "Service role full access on mev_escrows"
  on mev_escrows
  for all to service_role
  using (true)
  with check (true);

drop policy if exists "Service role full access on flashbots_bundles" on flashbots_bundles;
create policy "Service role full access on flashbots_bundles"
  on flashbots_bundles
  for all to service_role
  using (true)
  with check (true);

revoke all on table mev_commitments from anon, authenticated;
revoke all on table mev_escrows from anon, authenticated;
revoke all on table flashbots_bundles from anon, authenticated;
