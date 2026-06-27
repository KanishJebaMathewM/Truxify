-- Track failed escrow releases so completed deliveries can be reconciled safely.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS escrow_release_error TEXT,
  ADD COLUMN IF NOT EXISTS escrow_release_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escrow_release_last_attempt_at TIMESTAMPTZ;
