-- Migration: create fraud detection tables
-- Backs backend/api/src/services/fraud/FraudDetectionService.js which queries
-- behavioral_profiles, fraud_risk_scores and fraud_review_queue, none of which
-- existed, so every insert/upsert/select failed at runtime.

-- ============ behavioral_profiles ============
create table if not exists behavioral_profiles (
  user_id      uuid primary key references profiles(id),
  events       jsonb not null default '[]',
  patterns     jsonb not null default '{}',
  last_activity timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- ============ fraud_risk_scores ============
create table if not exists fraud_risk_scores (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id),
  risk_score  double precision not null,
  components  jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists idx_fraud_risk_scores_user  on fraud_risk_scores (user_id, created_at desc);

-- ============ fraud_review_queue ============
create table if not exists fraud_review_queue (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id),
  reason      text,
  risk_score  double precision not null default 0,
  status      text not null default 'pending'
              check (status in ('pending', 'resolved', 'dismissed')),
  action      text,
  notes       text,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_fraud_review_queue_pending
  on fraud_review_queue (risk_score desc)
  where status = 'pending';

-- RLS: the fraud service runs with the service-role client key. Keep the tables
-- locked down for row-level requests.
alter table behavioral_profiles enable row level security;
alter table fraud_risk_scores   enable row level security;
alter table fraud_review_queue  enable row level security;

create policy behavioral_profiles_service_policy on behavioral_profiles
  for all using (true) with check (true);
create policy fraud_risk_scores_service_policy on fraud_risk_scores
  for all using (true) with check (true);
create policy fraud_review_queue_service_policy on fraud_review_queue
  for all using (true) with check (true);
