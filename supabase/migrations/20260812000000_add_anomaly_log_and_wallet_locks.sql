-- ============================================================================
-- Migration: Add anomaly_log and wallet_locks tables for security & fraud subsystem
-- Issue: #9934
-- ============================================================================

-- 1. anomaly_log table
CREATE TABLE IF NOT EXISTS public.anomaly_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    wallet_address TEXT,
    anomalies JSONB NOT NULL DEFAULT '[]'::jsonb,
    risk_level TEXT NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for anomaly_log
CREATE INDEX IF NOT EXISTS idx_anomaly_log_user_id ON public.anomaly_log(user_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_log_detected_at ON public.anomaly_log(detected_at DESC);

-- 2. wallet_locks table
CREATE TABLE IF NOT EXISTS public.wallet_locks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    wallet_address TEXT NOT NULL,
    reason TEXT,
    anomalies JSONB DEFAULT '[]'::jsonb,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_until TIMESTAMPTZ,
    unlocked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for wallet_locks
CREATE INDEX IF NOT EXISTS idx_wallet_locks_user_id ON public.wallet_locks(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_locks_wallet_address ON public.wallet_locks(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallet_locks_unlocked_at ON public.wallet_locks(unlocked_at) WHERE unlocked_at IS NULL;

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.anomaly_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_locks ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
-- Service role has full access for backend anomaly detection and locking operations
CREATE POLICY "Service role full access anomaly_log" ON public.anomaly_log
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access wallet_locks" ON public.wallet_locks
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Users can view their own wallet locks
CREATE POLICY "Users can view own wallet locks" ON public.wallet_locks
    FOR SELECT
    USING (auth.uid() = user_id);
