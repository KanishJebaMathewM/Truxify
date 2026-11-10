-- Create atomic_swaps table for HTLC escrow lifecycle tracking
CREATE TABLE IF NOT EXISTS public.atomic_swaps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    swap_id TEXT UNIQUE NOT NULL,
    initiator TEXT NOT NULL,
    counterparty TEXT,
    token_address TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    hash_lock TEXT NOT NULL,
    secret TEXT,
    tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    executed_tx_hash TEXT,
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.atomic_swaps ENABLE ROW LEVEL SECURITY;

-- Policy: Allow participants (initiator or counterparty) to view their atomic swaps
CREATE POLICY "Users can view their own atomic swaps"
    ON public.atomic_swaps
    FOR SELECT
    USING (auth.uid()::text = initiator OR auth.uid()::text = counterparty OR initiator = 'public');

-- Policy: Allow authenticated users to insert swaps
CREATE POLICY "Users can insert atomic swaps"
    ON public.atomic_swaps
    FOR INSERT
    WITH CHECK (true);

-- Policy: Allow participants to update their atomic swaps
CREATE POLICY "Users can update their own atomic swaps"
    ON public.atomic_swaps
    FOR UPDATE
    USING (auth.uid()::text = initiator OR auth.uid()::text = counterparty);

-- Create indexes for performance on frequent lookups
CREATE INDEX IF NOT EXISTS idx_atomic_swaps_swap_id ON public.atomic_swaps(swap_id);
CREATE INDEX IF NOT EXISTS idx_atomic_swaps_status ON public.atomic_swaps(status);
