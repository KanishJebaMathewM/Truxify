-- Fix OTP attempt tracking for #16080.
-- Adds the missing counter column and an atomic increment RPC.

ALTER TABLE public.phone_otps
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.increment_otp_attempts(otp_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_attempts INTEGER;
BEGIN
  UPDATE public.phone_otps
  SET attempts = attempts + 1
  WHERE id = otp_id
  RETURNING attempts INTO new_attempts;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  RETURN new_attempts;
END;
$$;

-- This RPC is intended for the backend service role only.
REVOKE EXECUTE ON FUNCTION public.increment_otp_attempts(UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.increment_otp_attempts(UUID)
TO service_role;