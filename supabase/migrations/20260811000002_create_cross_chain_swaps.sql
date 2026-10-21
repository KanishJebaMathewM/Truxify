-- Create cross_chain_swaps table for cross-chain atomic swap tracking
CREATE TABLE IF NOT EXISTS public.cross_chain_swaps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    swap_id TEXT UNIQUE NOT NULL,
    source_chain_id TEXT NOT NULL,
    dest_chain_id TEXT NOT NULL,
    initiator TEXT NOT NULL,
    counterparty TEXT,
    token_address TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    hash_lock TEXT NOT NULL,
    secret TEXT,
    proof TEXT,
    tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    executed_tx_hash TEXT,
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.cross_chain_swaps ENABLE ROW LEVEL SECURITY;

-- Policy: Allow participants (initiator or counterparty) to view their cross-chain swaps
CREATE POLICY "Users can view their own cross chain swaps"
    ON public.cross_chain_swaps
    FOR SELECT
    USING (auth.uid()::text = initiator OR auth.uid()::text = counterparty OR initiator = 'public');

-- Policy: Allow authenticated users to insert cross-chain swaps
CREATE POLICY "Users can insert cross chain swaps"
    ON public.cross_chain_swaps
    FOR INSERT
    WITH CHECK (true);

-- Policy: Allow participants to update their cross-chain swaps
CREATE POLICY "Users can update their own cross chain swaps"
    ON public.cross_chain_swaps
    FOR UPDATE
    USING (auth.uid()::text = initiator OR auth.uid()::text = counterparty);

-- Create performance indexes
CREATE INDEX IF NOT EXISTS idx_cross_chain_swaps_swap_id ON public.cross_chain_swaps(swap_id);
CREATE INDEX IF NOT EXISTS idx_cross_chain_swaps_status ON public.cross_chain_swaps(status);
