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

-- SECURITY MODEL: outbox_events is an internal ledger written and read only by
-- backend services using the service-role admin client (see
-- backend/api/src/services/outbox/outboxService.js). Enable RLS and scope every
-- operation to service_role so the shared anon key can never touch this table.
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on outbox_events" ON outbox_events;
CREATE POLICY "Service role full access on outbox_events"
  ON outbox_events
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE outbox_events FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_outbox_events_status_created
  ON outbox_events (status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_outbox_events_aggregate
  ON outbox_events (aggregate_id, aggregate_type);