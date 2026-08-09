-- Add escrow deposit verification columns to the orders table.
--
-- These are persisted at bid-accept time so confirm-deposit can verify that
-- the on-chain booking was created by the registered customer, for the
-- assigned driver, and for the expected escrow amount. This prevents an
-- attacker from pre-creating the deterministic booking id with a dust amount.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS escrow_amount_wei TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS escrow_driver_wallet TEXT;
