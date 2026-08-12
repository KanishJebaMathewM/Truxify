-- Dead-letter store for failed Kafka message handlers.
-- Mirrors kafka_processed_events' role: durable record of what Kafka delivered,
-- so failures can be audited and replayed instead of silently dropped.

create table if not exists kafka_dead_letters (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  message jsonb not null,
  error text not null,
  retry_count int not null default 0,
  status text not null default 'pending', -- pending | replayed | discarded
  created_at timestamptz not null default now(),
  replayed_at timestamptz
);

create index if not exists idx_kafka_dead_letters_status
  on kafka_dead_letters (status, created_at);

create index if not exists idx_kafka_dead_letters_topic
  on kafka_dead_letters (topic);