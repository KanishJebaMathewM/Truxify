-- ============================================================================
-- TOKENIZATION — Asset / Transaction / Trade Order Tables
-- ============================================================================
-- The tokenization module (backend/tokenization/token.service.js) persists
-- tokenized assets, purchase/sell transactions and trade orders into
-- `tokenized_assets`, `token_transactions` and `trade_orders`, and reads them
-- back for stats. No migration previously created any of them, so every
-- operation failed with `relation ... does not exist`. This migration creates
-- all three tables with columns matching the inserts and selects in
-- token.service.js.
--
-- SECURITY MODEL:
--   - Written by backend services using service_role credentials and never
--     exposed directly to clients, so RLS allows service_role only.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. TOKENIZED ASSETS TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists tokenized_assets (
  asset_id     text not null,            -- storeAsset: data.assetId
  name         text,                     -- storeAsset: data.name
  description  text,                     -- storeAsset: data.description
  asset_type   text,                     -- storeAsset: data.assetType
  total_value  text,                     -- storeAsset: data.totalValue
  total_tokens text,                     -- storeAsset: data.totalTokens
  tx_hash      text,                     -- storeAsset: data.txHash
  created_at   timestamptz not null default now(),
  primary key (asset_id)
);

create index if not exists idx_tokenized_assets_created_at
  on tokenized_assets (created_at);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. TOKEN TRANSACTIONS TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists token_transactions (
  id           bigint generated always as identity primary key,
  asset_id     text,                     -- storeTransaction: data.assetId
  user_address text,                     -- storeTransaction: data.userAddress
  amount       text,                     -- storeTransaction: data.amount
  total_cost   text not null default '0', -- storeTransaction: data.totalCost
  type         text,                     -- storeTransaction: data.type ('purchase' | 'sell' | 'trade')
  tx_hash      text,                     -- storeTransaction: data.txHash
  order_id     text,                     -- storeTransaction: data.orderId
  created_at   timestamptz not null default now(),
  constraint fk_token_transactions_asset
    foreign key (asset_id)
    references tokenized_assets (asset_id)
    on delete set null
);

create index if not exists idx_token_transactions_asset_id
  on token_transactions (asset_id);

create index if not exists idx_token_transactions_user_address
  on token_transactions (user_address);


-- ────────────────────────────────────────────────────────────────────────────
-- 3. TRADE ORDERS TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists trade_orders (
  order_id    text not null,             -- storeTradeOrder: data.orderId
  asset_id    text,                      -- storeTradeOrder: data.assetId
  user_address text,                     -- storeTradeOrder: data.userAddress
  amount      text,                      -- storeTradeOrder: data.amount
  price       text,                      -- storeTradeOrder: data.price
  order_type  text,                      -- storeTradeOrder: data.orderType
  tx_hash     text,                      -- storeTradeOrder: data.txHash
  status      text not null default 'active', -- storeTradeOrder: status
  created_at  timestamptz not null default now(),
  primary key (order_id),
  constraint fk_trade_orders_asset
    foreign key (asset_id)
    references tokenized_assets (asset_id)
    on delete set null
);

create index if not exists idx_trade_orders_asset_id
  on trade_orders (asset_id);

create index if not exists idx_trade_orders_status
  on trade_orders (status);


-- ────────────────────────────────────────────────────────────────────────────
-- 4. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table tokenized_assets enable row level security;
alter table token_transactions enable row level security;
alter table trade_orders enable row level security;

drop policy if exists "Service role full access on tokenized_assets" on tokenized_assets;
create policy "Service role full access on tokenized_assets"
  on tokenized_assets
  for all to service_role
  using (true)
  with check (true);

drop policy if exists "Service role full access on token_transactions" on token_transactions;
create policy "Service role full access on token_transactions"
  on token_transactions
  for all to service_role
  using (true)
  with check (true);

drop policy if exists "Service role full access on trade_orders" on trade_orders;
create policy "Service role full access on trade_orders"
  on trade_orders
  for all to service_role
  using (true)
  with check (true);

revoke all on table tokenized_assets from anon, authenticated;
revoke all on table token_transactions from anon, authenticated;
revoke all on table trade_orders from anon, authenticated;
