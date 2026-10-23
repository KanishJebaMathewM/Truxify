-- Create zk_proofs table for zero-knowledge proof verification storage
CREATE TABLE IF NOT EXISTS public.zk_proofs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    proof JSONB NOT NULL,
    public_signals JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.zk_proofs ENABLE ROW LEVEL SECURITY;

-- Policy: Allow users to view their own ZK proofs
CREATE POLICY "Users can view their own zk proofs"
    ON public.zk_proofs
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Allow insertion of ZK proofs (accommodating service or client-side submission workflows)
CREATE POLICY "Allow insertion of zk proofs"
    ON public.zk_proofs
    FOR INSERT
    WITH CHECK (true);

-- Create performance indexes
CREATE INDEX IF NOT EXISTS idx_zk_proofs_user_id ON public.zk_proofs(user_id);
