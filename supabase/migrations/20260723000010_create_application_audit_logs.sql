-- Application-level audit logging table for privileged administrative operations.
-- Captures actor identity, action, resource details, request metadata, and timestamps.
-- This table is distinct from database-level triggers; it records application context.

CREATE TABLE IF NOT EXISTS application_audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      UUID NOT NULL,
  actor_role    TEXT NOT NULL,
  actor_name    TEXT,
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   TEXT,
  method        TEXT NOT NULL,
  path          TEXT NOT NULL,
  ip_address    TEXT,
  user_agent    TEXT,
  correlation_id TEXT,
  request_id    TEXT,
  status_code   INTEGER,
  before_state  JSONB,
  after_state   JSONB,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON application_audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON application_audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_type ON application_audit_logs (resource_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_id ON application_audit_logs (resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON application_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created ON application_audit_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON application_audit_logs (resource_type, resource_id, created_at DESC);

-- Composite index for the audit history API common query pattern
CREATE INDEX IF NOT EXISTS idx_audit_logs_filtered ON application_audit_logs (action, resource_type, created_at DESC);

-- RLS policies: only service role can write, admin role can read
ALTER TABLE application_audit_logs ENABLE ROW LEVEL SECURITY;

-- Admin users can read audit logs
CREATE POLICY "Admins can read audit logs"
  ON application_audit_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Only service role (backend) can insert audit logs via the admin client
CREATE POLICY "Service role can insert audit logs"
  ON application_audit_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Prevent updates and deletes on audit logs for integrity
CREATE POLICY "No updates on audit logs"
  ON application_audit_logs
  FOR UPDATE
  TO authenticated
  USING (false);

CREATE POLICY "No deletes on audit logs"
  ON application_audit_logs
  FOR DELETE
  TO authenticated
  USING (false);

COMMENT ON TABLE application_audit_logs IS 'Application-level audit trail for privileged administrative operations. Captures actor identity, action, resource, request metadata, and optional before/after state.';
COMMENT ON COLUMN application_audit_logs.actor_id IS 'UUID of the user who performed the action';
COMMENT ON COLUMN application_audit_logs.actor_role IS 'Role of the actor at time of action (admin, driver, customer)';
COMMENT ON COLUMN application_audit_logs.action IS 'Semantic action identifier (e.g., admin:view-dashboard, order:cancel, fraud:resolve-review)';
COMMENT ON COLUMN application_audit_logs.resource_type IS 'Type of resource affected (e.g., order, profile, support_ticket, fraud_review)';
COMMENT ON COLUMN application_audit_logs.resource_id IS 'Identifier of the specific resource affected, if applicable';
COMMENT ON COLUMN application_audit_logs.before_state IS 'JSON snapshot of resource state before the action, when available';
COMMENT ON COLUMN application_audit_logs.after_state IS 'JSON snapshot of resource state after the action, when available';
COMMENT ON COLUMN application_audit_logs.metadata IS 'Additional contextual information as JSON';
