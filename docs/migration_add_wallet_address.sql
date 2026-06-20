-- Migration: Add wallet_address to profiles table
-- Stores the user's Polygon (EVM) wallet address for escrow deposits and
-- on-chain reputation updates.
-- Add unique constraint to prevent duplicate wallet registration.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS wallet_address TEXT;

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_wallet_address_key;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_wallet_address_key UNIQUE (wallet_address);
