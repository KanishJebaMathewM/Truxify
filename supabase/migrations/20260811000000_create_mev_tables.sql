-- ============================================================================
-- Migration: Create MEV Protection Tables (mev_commitments & mev_escrows)
-- Issue: #9948
-- ============================================================================

-- 1. Create mev_commitments table
CREATE TABLE IF NOT EXISTS public.mev_commitments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    secret_hash TEXT NOT NULL,
    tx_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Create mev_escrows table
CREATE TABLE IF NOT EXISTS public.mev_escrows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escrow_id TEXT UNIQUE NOT NULL,
    customer UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    driver UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    amount NUMERIC(12, 2) NOT NULL,
    commit_hash TEXT,
    secret_hash TEXT,
    tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    released_tx_hash TEXT,
    released_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_mev_commitments_user_id ON public.mev_commitments(user_id);
CREATE INDEX IF NOT EXISTS idx_mev_escrows_customer ON public.mev_escrows(customer);
CREATE INDEX IF NOT EXISTS idx_mev_escrows_driver ON public.mev_escrows(driver);
CREATE INDEX IF NOT EXISTS idx_mev_escrows_status ON public.mev_escrows(status);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.mev_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mev_escrows ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for mev_commitments
CREATE POLICY "Users can view their own commitments"
    ON public.mev_commitments
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own commitments"
    ON public.mev_commitments
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- 6. RLS Policies for mev_escrows
CREATE POLICY "Participants can view their escrows"
    ON public.mev_escrows
    FOR SELECT
    USING (auth.uid() = customer OR auth.uid() = driver);

CREATE POLICY "Customers can create escrows"
    ON public.mev_escrows
    FOR INSERT
    WITH CHECK (auth.uid() = customer);

CREATE POLICY "Participants can update their escrows"
    ON public.mev_escrows
    FOR UPDATE
    USING (auth.uid() = customer OR auth.uid() = driver);
