-- ============================================================================
-- KEY ROTATION RECORDS — wallet key rotation history
-- ============================================================================
-- Backend services (keyRotationService.js) record each wallet key rotation here
-- so the rotation lifecycle (in_progress -> completed/failed) can be tracked and
-- audited, and so rotation policies can be enforced from history.
--
-- SECURITY MODEL:
--   - Written by backend services using the service_role key and never exposed
--     to clients, so RLS allows service_role only.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. KEY ROTATIONS TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists key_rotations (
  rotation_id    varchar(255) primary key,  -- service-generated id (e.g. rot_<hex>)
  user_id        uuid not null,
  wallet_address varchar(255) not null,
  reason         varchar(100),              -- 'routine', 'security_breach', 'device_compromise'
  status         varchar(50),               -- 'in_progress', 'completed', 'failed'
  new_key_id     uuid,
  initiated_at   timestamptz not null default now(),
  completed_at   timestamptz
);

create index if not exists idx_rotations_user_wallet
  on key_rotations (user_id, wallet_address);

create index if not exists idx_rotations_initiated_at
  on key_rotations (initiated_at);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table key_rotations enable row level security;

drop policy if exists "Service role full access on key_rotations"
  on key_rotations;
create policy "Service role full access on key_rotations"
  on key_rotations
  for all to service_role
  using (true)
  with check (true);

revoke all on table key_rotations from anon, authenticated;
