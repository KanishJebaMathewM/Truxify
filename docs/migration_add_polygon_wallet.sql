-- Migration: Add polygon_wallet_address to driver_details
-- This column stores the driver's Polygon (EVM) wallet address so the
-- backend relayer can call Reputation.sol.increaseReputation() after a
-- successful rating submission.
-- Nullable — drivers without a registered wallet address will simply
-- skip the on-chain step; the off-chain Supabase rating is always saved.

ALTER TABLE driver_details
  ADD COLUMN IF NOT EXISTS polygon_wallet_address TEXT;
