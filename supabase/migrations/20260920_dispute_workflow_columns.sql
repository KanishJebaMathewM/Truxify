-- Adds dispute workflow trigger tracking and escalation timestamp.
-- dispute_n8n_triggered_at: owned by the n8n route handler exclusively.
--   NULL = workflow not yet triggered; non-null = already triggered (idempotency guard).
-- escalated_at: set by PATCH /api/dispute/escalate.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dispute_n8n_triggered_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_orders_dispute_n8n_triggered
  ON orders (dispute_n8n_triggered_at)
  WHERE dispute_n8n_triggered_at IS NOT NULL;
