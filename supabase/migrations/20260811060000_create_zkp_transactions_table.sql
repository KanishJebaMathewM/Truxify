-- ============================================================================
-- ZKP TRANSACTIONS TABLE
-- ============================================================================
-- The ZKP service (backend/zkp/zkp.service.js) persists processed and created
-- private transactions into `zkp_transactions` and reads them back for replay
-- checks and stats. No migration previously created this table, so every
-- insert/select failed with `relation "zkp_transactions" does not exist`. This
-- migration creates the table with columns matching the inserts, selects and
-- nullifier lookups in zkp.service.js.
--
-- SECURITY MODEL:
--   - Written by backend services using service_role credentials and never
--     exposed directly to clients, so RLS allows service_role only.
-- ============================================================================

create table if not exists zkp_transactions (
  tx_id      text primary key,            -- storeTransaction: data.txId || data.nullifier
  nullifier  text,                        -- processPrivateTransaction: replay check
  commitment text,
  recipient  text,                        -- recipient address
  amount     text,                        -- amount in the denomination sent to the contract
  tx_hash    text,                        -- on-chain transaction hash
  status     text not null default 'pending', -- 'pending' | 'created' | 'processed' | ...
  created_at timestamptz not null default now()
);

-- Nullifier replay protection: the service checks for an existing row before
-- processing, and the unique index makes double-spend impossible at the DB
-- level. Multiple NULLs (created transactions carry no nullifier) are allowed.
create unique index if not exists idx_zkp_transactions_nullifier
  on zkp_transactions (nullifier);

create index if not exists idx_zkp_transactions_status
  on zkp_transactions (status);

alter table zkp_transactions enable row level security;

drop policy if exists "Service role full access on zkp_transactions"
  on zkp_transactions;
create policy "Service role full access on zkp_transactions"
  on zkp_transactions
  for all to service_role
  using (true)
  with check (true);

revoke all on table zkp_transactions from anon, authenticated;
