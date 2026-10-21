-- ============================================================================
-- Migration: Add blockchain divergence and state reconciliation tables
-- Issue: #9936
-- ============================================================================

-- 1. blockchain_divergence_log table
CREATE TABLE IF NOT EXISTS public.blockchain_divergence_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    divergence_id TEXT UNIQUE NOT NULL,
    severity TEXT NOT NULL,
    block_divergence JSONB NOT NULL DEFAULT '{}'::jsonb,
    node_states JSONB NOT NULL DEFAULT '[]'::jsonb,
    canonical_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    resolution_details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blockchain_divergence_log_detected_at ON public.blockchain_divergence_log(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_blockchain_divergence_log_resolved ON public.blockchain_divergence_log(resolved) WHERE resolved = FALSE;

-- 2. blockchain_reconciliation_jobs table
CREATE TABLE IF NOT EXISTS public.blockchain_reconciliation_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT NOT NULL DEFAULT 'pending',
    source_block_number BIGINT,
    canonical_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blockchain_recon_jobs_status ON public.blockchain_reconciliation_jobs(status);

-- 3. state_reconciliations table
CREATE TABLE IF NOT EXISTS public.state_reconciliations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reconciliation_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'completed',
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    reconciled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_state_reconciliations_created_at ON public.state_reconciliations(created_at DESC);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.blockchain_divergence_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blockchain_reconciliation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.state_reconciliations ENABLE ROW LEVEL SECURITY;

-- 5. Service Role RLS Policies (Restricted to backend/admin workers)
CREATE POLICY "Service role full access blockchain_divergence_log" ON public.blockchain_divergence_log
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access blockchain_reconciliation_jobs" ON public.blockchain_reconciliation_jobs
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access state_reconciliations" ON public.state_reconciliations
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
