-- Migration: cross-process claim lock for the outbox relay worker.
--
-- Problem: every API replica runs startOutboxRelayWorker() and each one was
-- doing a plain SELECT ... WHERE status='pending', so N replicas fetched the
-- SAME pending rows and published N copies of every domain event to Kafka
-- (issue #14680). The only in-process guard (_running) does nothing across
-- processes, and each BaseEvent got a fresh random eventId, defeating dedup.
--
-- Fix: add a 'publishing' state plus owner/lease columns, and a SECURITY
-- DEFINER RPC (claim_outbox_batch) that atomically transitions a batch of
-- pending rows to 'publishing' using SELECT ... FOR UPDATE SKIP LOCKED so two
-- replicas can never claim the same row. A second RPC (reclaim_outbox_batch)
-- resets leases that expired (crashed worker) back to 'pending'.

-- Create the table if it does not already exist (idempotent across the
-- database/migrations and supabase/migrations paths).
CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id TEXT NOT NULL,
  aggregate_type TEXT NOT NULL DEFAULT 'order',
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'publishing', 'published', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_attempted_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- If the table already existed with the old 3-status CHECK / no claim columns,
-- reconcile to the new shape idempotently.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'outbox_events' AND column_name = 'claimed_by'
  ) THEN
    ALTER TABLE outbox_events
      ADD COLUMN claimed_by TEXT,
      ADD COLUMN claimed_at TIMESTAMPTZ,
      ADD COLUMN lease_expires_at TIMESTAMPTZ;
  END IF;
END $$;

ALTER TABLE outbox_events DROP CONSTRAINT IF EXISTS outbox_events_status_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_status_check
  CHECK (status IN ('pending', 'publishing', 'published', 'failed'));

CREATE INDEX IF NOT EXISTS idx_outbox_events_status_created
  ON outbox_events (status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_outbox_events_aggregate
  ON outbox_events (aggregate_id, aggregate_type);

-- Atomically claim up to p_batch_size pending rows for p_worker_id, marking
-- them 'publishing' with a finite lease. FOR UPDATE SKIP LOCKED guarantees
-- that concurrent claimants never take the same row.
CREATE OR REPLACE FUNCTION claim_outbox_batch(
  p_worker_id text,
  p_batch_size integer DEFAULT 50,
  p_lease_seconds integer DEFAULT 300
)
RETURNS SETOF outbox_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id
    FROM outbox_events
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE outbox_events o
  SET status = 'publishing',
      claimed_by = p_worker_id,
      claimed_at = now(),
      lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval
  FROM claimed c
  WHERE o.id = c.id
  RETURNING o.*;
END;
$$;

-- Reset 'publishing' rows whose lease has expired (crashed worker) back to
-- 'pending' so any replica can reclaim them. Only reclaims rows whose lease
-- expired at least p_lease_buffer_seconds ago to avoid racing an in-flight
-- publish.
CREATE OR REPLACE FUNCTION reclaim_outbox_batch(
  p_lease_buffer_seconds integer DEFAULT 60,
  p_batch_size integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  reclaimed integer;
BEGIN
  WITH expired AS (
    SELECT id
    FROM outbox_events
    WHERE status = 'publishing'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at < now() - (p_lease_buffer_seconds || ' seconds')::interval
    ORDER BY lease_expires_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE outbox_events o
  SET status = 'pending',
      claimed_by = NULL,
      claimed_at = NULL,
      lease_expires_at = NULL
  FROM expired e
  WHERE o.id = e.id;

  GET DIAGNOSTICS reclaimed = ROW_COUNT;
  RETURN reclaimed;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_outbox_batch(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION reclaim_outbox_batch(integer, integer) TO service_role;
