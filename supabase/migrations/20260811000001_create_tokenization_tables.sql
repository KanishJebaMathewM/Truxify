-- ============================================================================
-- Migration: Create Tokenization Tables (tokenized_assets, token_transactions, trade_orders)
-- Issue: #9944
-- ============================================================================

-- 1. Create tokenized_assets table
CREATE TABLE IF NOT EXISTS public.tokenized_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    asset_type TEXT NOT NULL,
    total_value NUMERIC(15, 2) NOT NULL,
    total_tokens NUMERIC(15, 2) NOT NULL,
    tx_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Create token_transactions table
CREATE TABLE IF NOT EXISTS public.token_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id TEXT NOT NULL REFERENCES public.tokenized_assets(asset_id) ON DELETE CASCADE,
    user_address TEXT NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    total_cost NUMERIC(15, 2),
    type TEXT NOT NULL,
    tx_hash TEXT,
    order_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. Create trade_orders table
CREATE TABLE IF NOT EXISTS public.trade_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id TEXT UNIQUE NOT NULL,
    asset_id TEXT NOT NULL REFERENCES public.tokenized_assets(asset_id) ON DELETE CASCADE,
    user_address TEXT NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    price NUMERIC(15, 2) NOT NULL,
    order_type TEXT NOT NULL,
    tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tokenized_assets_asset_id ON public.tokenized_assets(asset_id);
CREATE INDEX IF NOT EXISTS idx_token_transactions_asset_id ON public.token_transactions(asset_id);
CREATE INDEX IF NOT EXISTS idx_token_transactions_user_address ON public.token_transactions(user_address);
CREATE INDEX IF NOT EXISTS idx_trade_orders_order_id ON public.trade_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_trade_orders_asset_id ON public.trade_orders(asset_id);
CREATE INDEX IF NOT EXISTS idx_trade_orders_status ON public.trade_orders(status);

-- 5. Enable Row Level Security (RLS)
ALTER TABLE public.tokenized_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_orders ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies (Supporting public secondary-market readability & service inserts)
CREATE POLICY "Allow public read access to tokenized assets"
    ON public.tokenized_assets
    FOR SELECT
    USING (true);

CREATE POLICY "Allow insert on tokenized assets"
    ON public.tokenized_assets
    FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Allow public read access to token transactions"
    ON public.token_transactions
    FOR SELECT
    USING (true);

CREATE POLICY "Allow insert on token transactions"
    ON public.token_transactions
    FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Allow public read access to trade orders"
    ON public.trade_orders
    FOR SELECT
    USING (true);

CREATE POLICY "Allow insert and update on trade orders"
    ON public.trade_orders
    FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Allow update on trade orders"
    ON public.trade_orders
    FOR UPDATE
    USING (true);
