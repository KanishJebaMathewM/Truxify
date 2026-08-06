-- ============================================================================
-- KAFKA DEAD-LETTER QUEUE — DLQ Table
-- ============================================================================
-- The Kafka dead-letter repository (backend/kafka/repositories/
-- deadLetter.repository.js) persists failed messages into `kafka_dead_letters`
-- and reads them back for replay (store / listPending / markStatus). No
-- migration in the applied supabase/migrations set ever created the table — the
-- only DDL lived in docs/supabase/migrations/005_create_kafka_dead_letters.sql,
-- a docs artifact outside the applied set — so every store() failed and each
-- failed message was silently dropped. This migration creates the table with
-- columns matching the inserts in deadLetter.repository.js.
--
-- SECURITY MODEL:
--   - Written by backend services using the service_role key (the repository
--     was switched to supabaseAdmin) and never exposed to clients, so RLS
--     allows service_role only and anon/authenticated have no grants.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. DEAD-LETTER TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists kafka_dead_letters (
  id          uuid not null default gen_random_uuid(),
  topic       text not null,          -- kafka topic (e.g. 'order.created')
  message     jsonb not null,         -- dlq entry: { topic, message, error, timestamp, retryCount }
  error       text,                   -- handler error message
  retry_count integer not null default 0,
  status      text not null default 'pending',  -- pending | replayed
  created_at  timestamptz not null default now(),
  replayed_at timestamptz,
  primary key (id)
);

create index if not exists idx_kafka_dead_letters_status
  on kafka_dead_letters (status);

create index if not exists idx_kafka_dead_letters_topic
  on kafka_dead_letters (topic);

create index if not exists idx_kafka_dead_letters_created
  on kafka_dead_letters (created_at);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table kafka_dead_letters enable row level security;

drop policy if exists "Service role full access on kafka_dead_letters"
  on kafka_dead_letters;
create policy "Service role full access on kafka_dead_letters"
  on kafka_dead_letters
  for all to service_role
  using (true)
  with check (true);

revoke all on table kafka_dead_letters from anon, authenticated;
