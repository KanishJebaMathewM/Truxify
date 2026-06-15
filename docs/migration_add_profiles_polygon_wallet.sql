-- Migration: Add polygon_wallet_address to profiles table
-- This column stores the customer's Polygon (EVM) wallet address so the
-- backend relayer can call Escrow.sol.deposit() with the correct customer
-- address during the bid-accept escrow funding flow.
-- Nullable — customers without a registered wallet address will simply
-- skip the on-chain escrow deposit; the off-chain order is always saved.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS polygon_wallet_address TEXT;
