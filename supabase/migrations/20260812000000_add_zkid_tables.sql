-- ============================================================================
-- Migration: Add ZKID identity, credential, verification, and disclosure tables
-- Issue: #9592
-- ============================================================================

-- 1. zkid_identities table
CREATE TABLE IF NOT EXISTS public.zkid_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id TEXT UNIQUE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    did TEXT UNIQUE NOT NULL,
    public_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zkid_identities_identity_id ON public.zkid_identities(identity_id);
CREATE INDEX IF NOT EXISTS idx_zkid_identities_user_id ON public.zkid_identities(user_id);

-- 2. zkid_credentials table
CREATE TABLE IF NOT EXISTS public.zkid_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    credential_id TEXT UNIQUE NOT NULL,
    identity_id TEXT NOT NULL REFERENCES public.zkid_identities(identity_id) ON DELETE CASCADE,
    issuer_did TEXT NOT NULL,
    claim_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'issued',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zkid_credentials_credential_id ON public.zkid_credentials(credential_id);
CREATE INDEX IF NOT EXISTS idx_zkid_credentials_identity_id ON public.zkid_credentials(identity_id);

-- 3. zkid_verifications table
CREATE TABLE IF NOT EXISTS public.zkid_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    verification_id TEXT UNIQUE NOT NULL,
    verifier_did TEXT NOT NULL,
    credential_id TEXT REFERENCES public.zkid_credentials(credential_id) ON DELETE SET NULL,
    proof_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zkid_verifications_verification_id ON public.zkid_verifications(verification_id);

-- 4. zkid_disclosures table
CREATE TABLE IF NOT EXISTS public.zkid_disclosures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    disclosure_id TEXT UNIQUE NOT NULL,
    verification_id TEXT REFERENCES public.zkid_verifications(verification_id) ON DELETE CASCADE,
    disclosed_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zkid_disclosures_disclosure_id ON public.zkid_disclosures(disclosure_id);

-- 5. Enable Row Level Security (RLS)
ALTER TABLE public.zkid_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zkid_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zkid_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zkid_disclosures ENABLE ROW LEVEL SECURITY;

-- 6. Service Role Policies (Backend service access)
CREATE POLICY "Service role full access zkid_identities" ON public.zkid_identities
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access zkid_credentials" ON public.zkid_credentials
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access zkid_verifications" ON public.zkid_verifications
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access zkid_disclosures" ON public.zkid_disclosures
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
