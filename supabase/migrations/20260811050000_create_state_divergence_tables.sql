-- =============================================================================
-- Migration: create state divergence reconciliation tables
-- =============================================================================
-- Problem:
--   StateDivergenceDetector (backend/api/src/services/blockchain/
--   stateDivergenceDetector.js) reads and writes three Supabase tables —
--   blockchain_divergence_log, blockchain_reconciliation_jobs and
--   state_reconciliations — that are documented in
--   docs/state-divergence-detection.md but never created by any migration.
--   Every divergence check errors with PGRST202, so on-chain vs DB divergence
--   is never detected or reconciled.
--
-- Fix:
--   Create the three tables and their indexes exactly as documented in
--   docs/state-divergence-detection.md. All statements are idempotent so this
--   migration is safe to run even if a previous migration already created them.
-- =============================================================================

begin;

create table if not exists blockchain_divergence_log (
  divergence_id varchar(255) primary key,
  severity varchar(50),
  block_divergence int,
  node_states jsonb,
  canonical_state jsonb,
  detected_at timestamp,
  resolved boolean default false,
  resolved_at timestamp,
  resolution_details jsonb
);

create index if not exists idx_divergence_log_severity on blockchain_divergence_log(severity);
create index if not exists idx_divergence_log_detected_at on blockchain_divergence_log(detected_at);

create table if not exists blockchain_reconciliation_jobs (
  id uuid primary key default gen_random_uuid(),
  status varchar(50),
  source_block_number int,
  canonical_state jsonb,
  result jsonb,
  created_at timestamp,
  completed_at timestamp
);

create index if not exists idx_reconciliation_jobs_status on blockchain_reconciliation_jobs(status);

create table if not exists state_reconciliations (
  reconciliation_id varchar(255) primary key,
  old_state jsonb,
  new_state jsonb,
  block_number_difference int,
  initiated_at timestamp,
  completed_at timestamp,
  status varchar(50)
);

alter table blockchain_divergence_log enable row level security;
alter table blockchain_reconciliation_jobs enable row level security;
alter table state_reconciliations enable row level security;

drop policy if exists "Service role full access on blockchain_divergence_log" on blockchain_divergence_log;
create policy "Service role full access on blockchain_divergence_log"
  on blockchain_divergence_log for all
  to service_role
  using (true) with check (true);

drop policy if exists "Service role full access on blockchain_reconciliation_jobs" on blockchain_reconciliation_jobs;
create policy "Service role full access on blockchain_reconciliation_jobs"
  on blockchain_reconciliation_jobs for all
  to service_role
  using (true) with check (true);

drop policy if exists "Service role full access on state_reconciliations" on state_reconciliations;
create policy "Service role full access on state_reconciliations"
  on state_reconciliations for all
  to service_role
  using (true) with check (true);

revoke all on blockchain_divergence_log from anon, authenticated;
revoke all on blockchain_reconciliation_jobs from anon, authenticated;
revoke all on state_reconciliations from anon, authenticated;

commit;
