-- =============================================================================
-- Migration: create blockchain monitoring tables
-- =============================================================================
-- Problem:
--   The /api/blockchain/* API (wired in #7336) queries blockchain_monitoring_events,
--   blockchain_escalations and blockchain_metrics, but no migration ever created
--   them. Fresh provisioning returned PostgREST PGRST301 for every table-backed
--   endpoint, and the background metrics aggregator logged an error every 60s.
--
-- Fix:
--   Create the three tables exactly as documented in
--   docs/blockchain-monitoring-setup.md, enable RLS and grant service_role full
--   access (the background writers use the service-role client and the API reads
--   through supabaseAdmin), so monitoring data is admin-only.
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

alter table blockchain_monitoring_events enable row level security;
alter table blockchain_escalations enable row level security;
alter table blockchain_metrics enable row level security;

drop policy if exists "Service role full access on blockchain_monitoring_events" on blockchain_monitoring_events;
create policy "Service role full access on blockchain_monitoring_events"
  on blockchain_monitoring_events for all to service_role using (true) with check (true);

drop policy if exists "Service role full access on blockchain_escalations" on blockchain_escalations;
create policy "Service role full access on blockchain_escalations"
  on blockchain_escalations for all to service_role using (true) with check (true);

drop policy if exists "Service role full access on blockchain_metrics" on blockchain_metrics;
create policy "Service role full access on blockchain_metrics"
  on blockchain_metrics for all to service_role using (true) with check (true);

commit;
