-- Revoke excessive privileges from the anon role on sensitive tables
-- This ensures unauthenticated users cannot access or modify these tables directly

REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE ALL ON TABLE public.orders FROM anon;
REVOKE ALL ON TABLE public.vehicles FROM anon;
REVOKE ALL ON TABLE public.trips FROM anon;

-- Note: RLS policies should still be enabled and strictly defined 
-- for authenticated users, but revoking from anon adds an extra layer 
-- of security for unauthenticated access.
