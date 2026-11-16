-- Create dids table for decentralized identifier tracking
CREATE TABLE IF NOT EXISTS public.dids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    did TEXT UNIQUE NOT NULL,
    owner TEXT NOT NULL,
    public_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.dids ENABLE ROW LEVEL SECURITY;

-- Policy: Allow anyone to view DIDs (public identifiers)
CREATE POLICY "Allow public read access to dids"
    ON public.dids
    FOR SELECT
    USING (true);

-- Policy: Allow authenticated users or owners to insert DIDs
CREATE POLICY "Allow users to insert dids"
    ON public.dids
    FOR INSERT
    WITH CHECK (auth.uid()::text = owner OR owner = 'public' OR auth.role() = 'authenticated');

-- Policy: Allow owners to update their DIDs
CREATE POLICY "Allow owners to update their dids"
    ON public.dids
    FOR UPDATE
    USING (auth.uid()::text = owner);

-- Create performance indexes
CREATE INDEX IF NOT EXISTS idx_dids_did ON public.dids(did);
CREATE INDEX IF NOT EXISTS idx_dids_owner ON public.dids(owner);
