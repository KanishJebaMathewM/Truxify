-- ============================================================================
-- KEY ROTATION AUDIT LOG — append-only audit trail for key rotation attempts
-- ============================================================================
-- Backend services (keyRotationService.js logKeyRotationEvent) write one entry
-- per key rotation outcome (success/failed) so security investigations have a
-- tamper-resistant record of who initiated a rotation, from where, and why.
--
-- SECURITY MODEL:
--   - Written by backend services using the service_role key and never exposed
--     to clients, so RLS allows service_role only.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. KEY ROTATION AUDIT LOG TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists key_rotation_audit_log (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  wallet_address varchar(255),
  reason         varchar(100),              -- 'routine', 'security_breach', 'device_compromise'
  status         varchar(50),               -- 'success', 'failed'
  error_message  text,
  ip_address     varchar(64),
  timestamp      timestamptz not null default now()
);

create index if not exists idx_key_rotation_audit_log_user_wallet
  on key_rotation_audit_log (user_id, wallet_address);

create index if not exists idx_key_rotation_audit_log_timestamp
  on key_rotation_audit_log (timestamp);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table key_rotation_audit_log enable row level security;

drop policy if exists "Service role full access on key_rotation_audit_log"
  on key_rotation_audit_log;
create policy "Service role full access on key_rotation_audit_log"
  on key_rotation_audit_log
  for all to service_role
  using (true)
  with check (true);

revoke all on table key_rotation_audit_log from anon, authenticated;
