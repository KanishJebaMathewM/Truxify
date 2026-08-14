-- =============================================================================
-- Migration: create blockchain tables
-- =============================================================================
-- Problem:
--   The blockchain-monitoring service (backend/api/src/services/blockchain/*)
--   writes to three Supabase tables — blockchain_metrics,
--   blockchain_escalations and blockchain_monitoring_events — that were only
--   documented in docs/blockchain-monitoring-setup.md and never created by any
--   migration. On fresh provisioning the metrics aggregator fails every 60s and
--   the admin monitoring routes error out.
--
-- Fix:
--   Create the three tables and their indexes exactly as documented in
--   docs/blockchain-monitoring-setup.md. All statements are idempotent so this
--   migration is safe to run even if a previous migration already created them.
-- =============================================================================

begin;

create table if not exists blockchain_monitoring_events (
  id bigserial primary key,
  type varchar(255) not null,
  severity varchar(50) not null,
  data jsonb,
  created_at timestamp default now()
);

create index if not exists idx_monitoring_events_type on blockchain_monitoring_events(type);
create index if not exists idx_monitoring_events_created_at on blockchain_monitoring_events(created_at);

create table if not exists blockchain_escalations (
  alert_id varchar(255) primary key,
  alert_type varchar(255) not null,
  severity varchar(50),
  escalation_level int,
  created_at timestamp,
  resolved boolean default false,
  resolved_at timestamp,
  escalation_history jsonb,
  data jsonb
);

create index if not exists idx_escalations_created_at on blockchain_escalations(created_at);
create index if not exists idx_escalations_resolved on blockchain_escalations(resolved);

create table if not exists blockchain_metrics (
  id bigserial primary key,
  timestamp timestamp default now(),
  contract_call_success_rate int,
  payment_processing_latency_avg int,
  withdrawal_queue_depth int,
  failed_transaction_count int,
  driver_payout_delay_avg int,
  blocks_scanned_per_day int,
  geofence_breach_count int,
  insurance_events_count int
);

create index if not exists idx_metrics_timestamp on blockchain_metrics(timestamp);

commit;
