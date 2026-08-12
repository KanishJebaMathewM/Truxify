-- =============================================================================
-- Migration: create wallet_locks and anomaly_log tables
-- =============================================================================
-- Problem:
--   AnomalyDetectionService (backend/api/src/services/security/
--   anomalyDetectionService.js) writes to two Supabase tables — wallet_locks
--   and anomaly_log — that are documented in docs/secure-key-management.md but
--   never created by any migration. Every lock/unlock call errors with PGRST202
--   and the error is swallowed by catch blocks, so account auto-lock after
--   detected anomalies never persists and the anomaly audit log is never
--   written.
--
-- Fix:
--   Create both tables and their indexes exactly as documented in
--   docs/secure-key-management.md. All statements are idempotent so this
--   migration is safe to run even if a previous migration already created them.
-- =============================================================================

begin;

create table if not exists anomaly_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  wallet_address varchar(255),
  anomalies jsonb,
  risk_level varchar(50),
  detected_at timestamp default now()
);

create index if not exists idx_anomaly_log_user_wallet on anomaly_log(user_id, wallet_address);
create index if not exists idx_anomaly_log_risk_level on anomaly_log(risk_level);

create table if not exists wallet_locks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  wallet_address varchar(255),
  reason varchar(255),
  anomalies jsonb,
  locked_at timestamp,
  locked_until timestamp,
  unlocked_at timestamp
);

create index if not exists idx_wallet_locks_user_wallet on wallet_locks(user_id, wallet_address);
create index if not exists idx_wallet_locks_active on wallet_locks(locked_at, unlocked_at);

alter table anomaly_log enable row level security;
alter table wallet_locks enable row level security;

drop policy if exists "Service role full access on anomaly_log" on anomaly_log;
create policy "Service role full access on anomaly_log"
  on anomaly_log for all
  to service_role
  using (true) with check (true);

drop policy if exists "Service role full access on wallet_locks" on wallet_locks;
create policy "Service role full access on wallet_locks"
  on wallet_locks for all
  to service_role
  using (true) with check (true);

revoke all on anomaly_log from anon, authenticated;
revoke all on wallet_locks from anon, authenticated;

commit;
