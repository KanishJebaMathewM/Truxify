-- Create kyc_audit_logs table for tracking KYC verification actions and transactions
CREATE TABLE IF NOT EXISTS public.kyc_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    action TEXT NOT NULL DEFAULT 'KYC_VERIFICATION',
    status TEXT NOT NULL DEFAULT 'SUCCESS',
    tx_hash TEXT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.kyc_audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Allow users to view their own KYC audit logs
CREATE POLICY "Users can view their own kyc audit logs"
    ON public.kyc_audit_logs
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Allow insertion of KYC audit logs (accommodating service or client-side submission workflows)
CREATE POLICY "Allow insertion of kyc audit logs"
    ON public.kyc_audit_logs
    FOR INSERT
    WITH CHECK (true);

-- Create performance indexes
CREATE INDEX IF NOT EXISTS idx_kyc_audit_logs_user_id ON public.kyc_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_audit_logs_status ON public.kyc_audit_logs(status);
