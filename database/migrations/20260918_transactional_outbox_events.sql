-- Migration: Transactional Outbox Pattern & Event Sourcing for Order Lifecycle
-- Creates outbox_events, processed_domain_events, and batch-claiming RPC

CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(64) NOT NULL DEFAULT 'order',
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 5,
    error_message TEXT,
    idempotency_key VARCHAR(255) UNIQUE,
    claimed_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_outbox_events_status_created ON outbox_events(status, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_events_aggregate ON outbox_events(aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS idx_outbox_events_idempotency ON outbox_events(idempotency_key);

-- Idempotent Consumer Tracking Table
CREATE TABLE IF NOT EXISTS processed_domain_events (
    event_id UUID NOT NULL,
    consumer_name VARCHAR(64) NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, consumer_name)
);

CREATE INDEX IF NOT EXISTS idx_processed_events_consumer ON processed_domain_events(consumer_name, processed_at);

-- Atomic Batch Claiming Function (SKIP LOCKED prevents concurrency collisions)
CREATE OR REPLACE FUNCTION claim_outbox_events_batch(
    p_limit INTEGER DEFAULT 50,
    p_worker_id TEXT DEFAULT 'worker-1'
)
RETURNS TABLE (
    id UUID,
    aggregate_type VARCHAR(64),
    aggregate_id UUID,
    event_type VARCHAR(128),
    payload JSONB,
    retry_count INTEGER,
    max_retries INTEGER,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH pending_batch AS (
        SELECT outbox_events.id
        FROM outbox_events
        WHERE outbox_events.status IN ('PENDING', 'RETRY')
        ORDER BY outbox_events.created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    UPDATE outbox_events
    SET 
        status = 'PROCESSING',
        claimed_by = p_worker_id,
        retry_count = outbox_events.retry_count + 1
    FROM pending_batch
    WHERE outbox_events.id = pending_batch.id
    RETURNING 
        outbox_events.id,
        outbox_events.aggregate_type,
        outbox_events.aggregate_id,
        outbox_events.event_type,
        outbox_events.payload,
        outbox_events.retry_count,
        outbox_events.max_retries,
        outbox_events.created_at;
END;
$$;
