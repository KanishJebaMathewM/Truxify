CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id TEXT NOT NULL,
  aggregate_type TEXT NOT NULL DEFAULT 'order',
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_attempted_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_status_created
  ON outbox_events (status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_outbox_events_aggregate
  ON outbox_events (aggregate_id, aggregate_type);