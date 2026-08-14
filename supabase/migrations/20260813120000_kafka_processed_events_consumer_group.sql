-- ============================================================================
-- KAFKA CONSUMER IDEMPOTENCY — Scope registry per consumer group
-- ============================================================================
-- kafka_processed_events was originally keyed on (topic, event_id) only.
-- order.consumer.js runs FOUR independent consumer groups (order-service,
-- notification-service, analytics-service, fraud-service) that subscribe to
-- overlapping topics. Because the old PK had no consumer-group column, the
-- first group to claim a (topic, event_id) "ate" the claim and every other
-- group's claimProcessed() call returned isNew=false, silently dropping the
-- event for that group. This migration scopes the registry per consumer
-- group so redelivery to one group can never suppress delivery to another.
-- ============================================================================

-- Add the new column. Backfill existing rows with a placeholder so the
-- column can be made not-null; these rows are historical and will simply
-- never match a real consumer_group again (harmless — they just stop acting
-- as dedupe barriers, which is the intended behavior change anyway).
alter table kafka_processed_events
  add column if not exists consumer_group text not null default 'unknown';

alter table kafka_processed_events
  alter column consumer_group drop default;

-- Replace the PK with the consumer-group-scoped composite key.
alter table kafka_processed_events
  drop constraint if exists kafka_processed_events_pkey;

alter table kafka_processed_events
  add primary key (consumer_group, topic, event_id);

-- order_id index is still useful; leave as-is. Add an index to support
-- lookups/cleanup by consumer_group+topic if needed operationally.
create index if not exists idx_kafka_processed_events_group_topic
  on kafka_processed_events (consumer_group, topic);