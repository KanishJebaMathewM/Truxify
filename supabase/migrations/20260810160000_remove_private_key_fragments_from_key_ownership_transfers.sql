-- ============================================================================
-- REMOVE PRIVATE-KEY FRAGMENTS FROM KEY OWNERSHIP TRANSFERS — security cleanup
-- ============================================================================
-- keyRotationService.transferKeyOwnershipOnChain previously persisted truncated
-- private-key material (old_key / new_key columns held the first 10 characters
-- of the raw private keys). Truncated private-key material is still secret
-- bearing and must never be persisted.
--
-- This migration:
--   1. drops the old_key / new_key columns, deleting any historical truncated
--      key fragments stored in them;
--   2. adds old_wallet_address / new_wallet_address so the audit trail keeps
--      only non-sensitive metadata (public addresses, transaction hash,
--      block number, timestamp).
--
-- Dropping the columns removes the secret material with them. No key material
-- is copied, exported, or logged elsewhere. If an operational policy requires
-- preserving historical rows for forensics, that must be done out-of-band
-- BEFORE applying this migration — the truncated fragments cannot be restored
-- after it runs. Any retained copies must be treated as secret-bearing data.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. ADD NON-SENSITIVE PUBLIC-ADDRESS COLUMNS
-- ────────────────────────────────────────────────────────────────────────────
alter table key_ownership_transfers
  add column if not exists old_wallet_address varchar(255),
  add column if not exists new_wallet_address varchar(255);

create index if not exists idx_key_ownership_transfers_old_wallet
  on key_ownership_transfers (old_wallet_address);

create index if not exists idx_key_ownership_transfers_new_wallet
  on key_ownership_transfers (new_wallet_address);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. DROP PRIVATE-KEY FRAGMENT COLUMNS
-- ────────────────────────────────────────────────────────────────────────────
alter table key_ownership_transfers
  drop column if exists old_key,
  drop column if exists new_key;
