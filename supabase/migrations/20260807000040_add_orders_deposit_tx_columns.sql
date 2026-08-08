-- Fix #7537: add missing escrow deposit columns to orders.
-- The confirm-deposit flow writes deposit_tx_hash and escrow_deposited_at
-- on orders, which previously failed with PGRST204.
-- (Previously only defined in the unapplied docs/migration_add_escrow.sql.)
alter table orders
  add column if not exists deposit_tx_hash     text,
  add column if not exists escrow_deposited_at timestamptz;
