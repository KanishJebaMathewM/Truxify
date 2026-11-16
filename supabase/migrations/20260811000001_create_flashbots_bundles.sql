-- Create flashbots_bundles table for MEV protection bundle tracking
CREATE TABLE IF NOT EXISTS public.flashbots_bundles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escrow_id TEXT NOT NULL,
    bundle_id TEXT NOT NULL,
    block_number BIGINT NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.flashbots_bundles ENABLE ROW LEVEL SECURITY;

-- Policy: Restrict access strictly to the backend service role
CREATE POLICY "Allow backend service role access for flashbots_bundles"
    ON public.flashbots_bundles
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Create performance indexes for lookups
CREATE INDEX IF NOT EXISTS idx_flashbots_bundles_escrow_id ON public.flashbots_bundles(escrow_id);
CREATE INDEX IF NOT EXISTS idx_flashbots_bundles_bundle_id ON public.flashbots_bundles(bundle_id);
