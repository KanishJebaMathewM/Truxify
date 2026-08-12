-- ============================================================================
-- KEY OWNERSHIP TRANSFERS — audit trail for on-chain key ownership transfers
-- ============================================================================
-- keyRotationService.transferKeyOwnershipOnChain performs a successful on-chain
-- transferKeyOwnership transaction and then writes a receipt row here so the
-- audit trail of ownership transfers is persisted. No migration ever created
-- this table, so the insert after a successful chain transfer raised
-- `relation "key_ownership_transfers" does not exist` and the API reported
-- failure for an operation that had already committed on-chain.
--
-- SECURITY MODEL:
--   - Written by backend services using the service_role key and never exposed
--     to clients, so RLS allows service_role only.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. KEY OWNERSHIP TRANSFERS TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists key_ownership_transfers (
  id             uuid primary key default gen_random_uuid(),
  old_key        text not null,               -- truncated old key (e.g. '0x1234abcd...')
  new_key        text not null,               -- truncated new key (e.g. '0x5678efgh...')
  wallet_address varchar(255),                -- wallet whose ownership moved
  tx_hash        varchar(255),                -- on-chain transfer transaction hash
  block_number   bigint,                      -- block in which the transfer committed
  completed_at   timestamptz not null default now()
);

create index if not exists idx_key_ownership_transfers_wallet
  on key_ownership_transfers (wallet_address);

create index if not exists idx_key_ownership_transfers_completed_at
  on key_ownership_transfers (completed_at);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table key_ownership_transfers enable row level security;

drop policy if exists "Service role full access on key_ownership_transfers"
  on key_ownership_transfers;
create policy "Service role full access on key_ownership_transfers"
  on key_ownership_transfers
  for all to service_role
  using (true)
  with check (true);

revoke all on table key_ownership_transfers from anon, authenticated;
