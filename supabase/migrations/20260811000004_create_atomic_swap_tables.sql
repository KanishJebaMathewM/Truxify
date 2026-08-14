-- ============================================================================
-- ATOMIC SWAP — Swap / Cross-Chain Swap Tables
-- ============================================================================
-- The atomic-swap module (backend/atomic-swap/swap.service.js) persists swaps
-- and cross-chain swaps into `atomic_swaps` and `cross_chain_swaps`, and reads
-- them back for lookups and stats. No migration previously created either of
-- them, so every operation failed with `relation ... does not exist`. This
-- migration creates both tables with columns matching the inserts, updates and
-- selects in swap.service.js.
--
-- SECURITY MODEL:
--   - Written by backend services using service_role credentials and never
--     exposed directly to clients, so RLS allows service_role only.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. ATOMIC SWAPS TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists atomic_swaps (
  swap_id          text not null,        -- storeSwap: data.swapId
  initiator        text,                 -- storeSwap: data.initiator
  counterparty     text,                 -- storeSwap: data.counterparty
  token_address    text,                 -- storeSwap: data.tokenAddress
  amount           text,                 -- storeSwap: data.amount
  hash_lock        text,                 -- storeSwap: data.hashLock
  secret           text,                 -- storeSwap: data.secret
  tx_hash          text,                 -- storeSwap: data.txHash
  status           text not null default 'pending', -- storeSwap: status / updateSwapStatus
  executed_tx_hash text,                 -- updateSwapStatus: executed_tx_hash
  executed_at      timestamptz,          -- updateSwapStatus: executed_at
  created_at       timestamptz not null default now(),
  primary key (swap_id)
);

create index if not exists idx_atomic_swaps_initiator
  on atomic_swaps (initiator);

create index if not exists idx_atomic_swaps_counterparty
  on atomic_swaps (counterparty);

create index if not exists idx_atomic_swaps_status
  on atomic_swaps (status);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. CROSS CHAIN SWAPS TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists cross_chain_swaps (
  swap_id          text not null,        -- storeCrossChainSwap: data.swapId
  source_chain_id  text,                 -- storeCrossChainSwap: data.sourceChainId
  dest_chain_id    text,                 -- storeCrossChainSwap: data.destChainId
  initiator        text,                 -- storeCrossChainSwap: data.initiator
  counterparty     text,                 -- storeCrossChainSwap: data.counterparty
  token_address    text,                 -- storeCrossChainSwap: data.tokenAddress
  amount           text,                 -- storeCrossChainSwap: data.amount
  hash_lock        text,                 -- storeCrossChainSwap: data.hashLock
  secret           text,                 -- storeCrossChainSwap: data.secret
  proof            text,                 -- storeCrossChainSwap: data.proof
  tx_hash          text,                 -- storeCrossChainSwap: data.txHash
  status           text not null default 'pending', -- storeCrossChainSwap: status / updateCrossChainSwapStatus
  executed_tx_hash text,                 -- updateCrossChainSwapStatus: executed_tx_hash
  executed_at      timestamptz,          -- updateCrossChainSwapStatus: executed_at
  created_at       timestamptz not null default now(),
  primary key (swap_id)
);

create index if not exists idx_cross_chain_swaps_initiator
  on cross_chain_swaps (initiator);

create index if not exists idx_cross_chain_swaps_status
  on cross_chain_swaps (status);


-- ────────────────────────────────────────────────────────────────────────────
-- 3. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table atomic_swaps enable row level security;
alter table cross_chain_swaps enable row level security;

drop policy if exists "Service role full access on atomic_swaps" on atomic_swaps;
create policy "Service role full access on atomic_swaps"
  on atomic_swaps
  for all to service_role
  using (true)
  with check (true);

drop policy if exists "Service role full access on cross_chain_swaps" on cross_chain_swaps;
create policy "Service role full access on cross_chain_swaps"
  on cross_chain_swaps
  for all to service_role
  using (true)
  with check (true);

revoke all on table atomic_swaps from anon, authenticated;
revoke all on table cross_chain_swaps from anon, authenticated;
