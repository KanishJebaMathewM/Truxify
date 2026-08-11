-- Fix #7536: add missing escrow refund columns to orders.
-- escrowWebhookProcessor selects/updates refund_tx_hash and escrow_refunded_at
-- on orders, which previously failed with PGRST204.
-- (Previously only defined in the unapplied docs/migration_add_escrow.sql.)
alter table orders
  add column if not exists refund_tx_hash     text,
  add column if not exists escrow_refunded_at timestamptz;
