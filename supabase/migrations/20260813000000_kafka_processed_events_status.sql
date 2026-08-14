-- ============================================================================
-- KAFKA CONSUMER IDEMPOTENCY — Two-Phase Claim Status
-- ============================================================================
-- Kafka consumers run with at-least-once delivery semantics. Side-effect
-- events (wallet/earnings credits, notifications, ...) were previously claimed
-- as permanently "processed" BEFORE their handlers ran; if a handler threw,
-- the side effect never happened but the claim stayed, so the event was never
-- retried and the effect was lost forever (issue #11192).
--
-- This migration adds a two-phase claim to kafka_processed_events:
--   - claimProcessing() inserts the row with status = 'processing'
--   - after the handler succeeds it is flipped to 'completed'
--   - after a handler failure it is flipped to 'failed', so a later
--     redelivery (offset reset, replay, restart) can re-claim and retry it
--
-- Existing rows represent events that were fully processed before this
-- migration and default to 'completed'.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. ADD TWO-PHASE CLAIM COLUMNS
-- ────────────────────────────────────────────────────────────────────────────
alter table kafka_processed_events
  add column if not exists status     text        not null default 'completed',
  add column if not exists started_at timestamptz not null default now();

alter table kafka_processed_events
  drop constraint if exists kafka_processed_events_status_check;

alter table kafka_processed_events
  add constraint kafka_processed_events_status_check
  check (status in ('processing', 'completed', 'failed'));

create index if not exists idx_kafka_processed_events_status
  on kafka_processed_events (status)
  where status in ('processing', 'failed');
