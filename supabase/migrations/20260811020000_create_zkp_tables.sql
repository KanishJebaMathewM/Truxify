-- ============================================================================
-- ZKP KYC VERIFICATION — proofs, audit log, and profile status columns
-- ============================================================================
-- Backend services (backend/api/src/services/zkp/zkp.service.js) persist
-- generated ZK proofs and verification audit rows here and track KYC status
-- on the real user table (`profiles`). The app has no `users` table, so the
-- service reads/writes `profiles` instead.
--
-- SECURITY MODEL:
--   - Backend services write via the service_role key; zk_proofs and
--     kyc_audit_logs are never exposed to clients, so RLS allows
--     service_role only. profile status columns are only written by the
--     service_role client too (users must not self-flag as kyc_verified).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. PROFILE KYC STATUS COLUMNS
-- ────────────────────────────────────────────────────────────────────────────
alter table profiles
  add column if not exists kyc_verified   boolean not null default false,
  add column if not exists kyc_verified_at timestamptz,
  add column if not exists kyc_tx_hash    text;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. ZK PROOFS TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists zk_proofs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles(id) on delete cascade,
  proof          jsonb not null,
  public_signals jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists idx_zk_proofs_user_id
  on zk_proofs (user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. KYC AUDIT LOG TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists kyc_audit_logs (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references profiles(id) on delete cascade,
  action    varchar(100) not null,
  status    varchar(50) not null,
  tx_hash   text,
  timestamp timestamptz not null default now()
);

create index if not exists idx_kyc_audit_logs_user_id
  on kyc_audit_logs (user_id);

create index if not exists idx_kyc_audit_logs_timestamp
  on kyc_audit_logs (timestamp);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table zk_proofs enable row level security;

drop policy if exists "Service role full access on zk_proofs"
  on zk_proofs;
create policy "Service role full access on zk_proofs"
  on zk_proofs
  for all to service_role
  using (true)
  with check (true);

revoke all on table zk_proofs from anon, authenticated;

alter table kyc_audit_logs enable row level security;

drop policy if exists "Service role full access on kyc_audit_logs"
  on kyc_audit_logs;
create policy "Service role full access on kyc_audit_logs"
  on kyc_audit_logs
  for all to service_role
  using (true)
  with check (true);

revoke all on table kyc_audit_logs from anon, authenticated;
