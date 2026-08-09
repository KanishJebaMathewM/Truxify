-- ============================================================================
-- KAFKA CONSUMER IDEMPOTENCY — Processed-Event Registry
-- ============================================================================
-- Kafka consumers run with at-least-once delivery semantics, so the same
-- message can be redelivered after a consumer restart, rebalance, or handler
-- error.  This registry records every message that has already been applied so
-- consumers can skip duplicates before applying side effects (read-model
-- updates, wallet/earnings credits, notifications, etc.).
--
-- SECURITY MODEL:
--   - Keyed on (topic, event_id), the event's natural idempotency key.
--   - The registry is written by backend services using the service_role key
--     and is never exposed to clients, so RLS allows service_role only.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. PROCESSED-EVENT REGISTRY TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists kafka_processed_events (
  topic        text not null,       -- kafka topic (e.g. 'payment.confirmed')
  event_id     text not null,       -- original event id / message key
  order_id     uuid,                -- orders.id, when derivable from the event
  processed_at timestamptz not null default now(),
  primary key (topic, event_id)
);

create index if not exists idx_kafka_processed_events_order
  on kafka_processed_events (order_id);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table kafka_processed_events enable row level security;

drop policy if exists "Service role full access on kafka_processed_events"
  on kafka_processed_events;
create policy "Service role full access on kafka_processed_events"
  on kafka_processed_events
  for all to service_role
  using (true)
  with check (true);

revoke all on table kafka_processed_events from anon, authenticated;
