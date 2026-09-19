-- Migration: Add is_active and invalidation metadata to phone_otps table
-- Resolves #16055: Disentangles OTP usability lifecycle from user verification status.
-- Superseded OTPs are marked with is_active = false while verified remains false,
-- preserving audit trail integrity.

ALTER TABLE IF EXISTS public.phone_otps
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invalidated_reason TEXT;

-- Backfill existing records: any already-verified or expired OTPs must NOT be active
UPDATE public.phone_otps
SET is_active = FALSE
WHERE (verified = TRUE OR expires_at <= NOW())
  AND is_active = TRUE;

-- Index for fast lookup of active unverified OTPs per phone number
CREATE INDEX IF NOT EXISTS idx_phone_otps_active_lookup
  ON public.phone_otps (phone, is_active, expires_at DESC)
  WHERE is_active = TRUE;

-- Partial unique index to enforce at most one active unverified OTP per phone number
CREATE UNIQUE INDEX IF NOT EXISTS idx_phone_otps_single_active
  ON public.phone_otps (phone)
  WHERE is_active = TRUE AND verified = FALSE;
