-- Migration: Create credentials table for DID service
-- Resolves Issue #9939: backend/did/did.service.js references a non-existent table
-- 
-- This table stores Verifiable Credentials (VCs) issued by the Truxify platform.
-- It supports credential lifecycle management including issuance, revocation, and stats.

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create the credentials table
CREATE TABLE IF NOT EXISTS public.credentials (
    -- Primary identifier for the credential (usually a URN or UUID)
    credential_id TEXT PRIMARY KEY,
    
    -- The DID (Decentralized Identifier) of the subject receiving the credential
    subject TEXT NOT NULL,
    
    -- Type of credential (e.g., 'VerifiableCredential', 'TruxifyDriverLicense', 'ISO9001Cert')
    credential_type TEXT NOT NULL,
    
    -- JSON schema or context URL defining the credential structure
    schema TEXT,
    
    -- Timestamp when the credential was issued
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Optional expiration timestamp
    valid_until TIMESTAMPTZ,
    
    -- Blockchain transaction hash if the credential was anchored on-chain
    tx_hash TEXT,
    
    -- Cryptographic proof (JSON or string) used to verify the credential's authenticity
    proof JSONB,
    
    -- Revocation status
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Timestamp of revocation (null if not revoked)
    revoked_at TIMESTAMPTZ,
    
    -- The user ID (from profiles table) who owns/manages this credential
    -- Used for Row Level Security (RLS)
    owner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    
    -- Standard audit columns
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_credentials_subject ON public.credentials(subject);
CREATE INDEX IF NOT EXISTS idx_credentials_type ON public.credentials(credential_type);
CREATE INDEX IF NOT EXISTS idx_credentials_owner ON public.credentials(owner_id);
CREATE INDEX IF NOT EXISTS idx_credentials_revoked ON public.credentials(revoked) WHERE revoked = TRUE;
CREATE INDEX IF NOT EXISTS idx_credentials_issued_at ON public.credentials(issued_at DESC);

-- Create a trigger to automatically update the updated_at column
CREATE OR REPLACE FUNCTION update_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_credentials_updated_at
BEFORE UPDATE ON public.credentials
FOR EACH ROW
EXECUTE FUNCTION update_credentials_updated_at();

-- Enable Row Level Security (RLS)
ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;

-- RLS Policy 1: Users can view their own credentials
CREATE POLICY "Users can view own credentials"
ON public.credentials
FOR SELECT
USING (auth.uid() = owner_id OR subject = auth.jwt() ->> 'did');

-- RLS Policy 2: Users can insert their own credentials (or system inserts via service_role)
CREATE POLICY "Users can insert own credentials"
ON public.credentials
FOR INSERT
WITH CHECK (auth.uid() = owner_id);

-- RLS Policy 3: Users can update (revoke) their own credentials
CREATE POLICY "Users can update own credentials"
ON public.credentials
FOR UPDATE
USING (auth.uid() = owner_id);

-- RLS Policy 4: Service role (backend) has full access
-- Note: Supabase service_role automatically bypasses RLS, but this documents the intent.
-- No explicit policy needed for service_role bypass.

-- Add table comment for documentation
COMMENT ON TABLE public.credentials IS 'Stores Verifiable Credentials (VCs) issued by the Truxify DID service. Supports issuance, revocation, and lifecycle management.';
COMMENT ON COLUMN public.credentials.credential_id IS 'Unique identifier for the credential (URN or UUID)';
COMMENT ON COLUMN public.credentials.subject IS 'DID of the credential subject';
COMMENT ON COLUMN public.credentials.proof IS 'Cryptographic proof data (JSONB)';
COMMENT ON COLUMN public.credentials.owner_id IS 'References the user profile who owns this credential record';
COMMENT ON COLUMN public.credentials.created_at IS 'Timestamp of record creation';
COMMENT ON COLUMN public.credentials.updated_at IS 'Timestamp of last record update';
COMMENT ON COLUMN public.credentials.revoked IS 'Revocation status';
COMMENT ON COLUMN public.credentials.revoked_at IS 'Timestamp of revocation (null if not revoked)';
COMMENT ON COLUMN public.credentials.issued_at IS 'Timestamp of credential issuance';
COMMENT ON COLUMN public.credentials.valid_until IS 'Expiration timestamp (optional)';
COMMENT ON COLUMN public.credentials.tx_hash IS 'Blockchain transaction hash (optional)';
COMMENT ON COLUMN public.credentials.schema IS 'JSON schema or context URL (optional)';
COMMENT ON COLUMN public.credentials.credential_type IS 'Type of credential (e.g., "VerifiableCredential", "TruxifyDriverLicense", "ISO9001Cert")';
