-- Migration: Create webhook_failures table for DLQ
CREATE TABLE IF NOT EXISTS webhook_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  error_message text,
  retry_count integer DEFAULT 0,
  next_retry_at timestamptz DEFAULT NOW(),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'failed_permanently', 'resolved')),
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

-- Index for efficient polling
CREATE INDEX IF NOT EXISTS idx_webhook_failures_pending_retry ON webhook_failures(status, next_retry_at) WHERE status = 'pending';

-- Add RLS to restrict access (only Service Role can access this internal table)
ALTER TABLE webhook_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow Service Role full access to webhook_failures" 
  ON webhook_failures 
  FOR ALL 
  USING (true)
  WITH CHECK (true);
