-- Resolve ownership in the profiles namespace (issue #10496). The customer
-- app supplies its auth ID; callers already using profiles.id remain valid.
-- Every table predicate uses the trusted profile ID, never the input parameter.
CREATE OR REPLACE FUNCTION public.set_default_address(
  p_address_id UUID,
  p_user_id UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile_id UUID := public.get_profile_id();
  v_auth_subject TEXT := auth.jwt() ->> 'sub';
  v_exists BOOLEAN;
BEGIN
  IF v_profile_id IS NULL OR v_auth_subject IS NULL OR (
    p_user_id IS DISTINCT FROM v_profile_id
    AND p_user_id::text IS DISTINCT FROM v_auth_subject
  ) THEN
    RAISE EXCEPTION 'Unauthorized: you can only modify your own addresses';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.saved_addresses
    WHERE id = p_address_id AND user_id = v_profile_id
    FOR UPDATE
  ) INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'Address not found';
  END IF;

  UPDATE public.saved_addresses
  SET is_default = false
  WHERE user_id = v_profile_id AND id <> p_address_id;

  UPDATE public.saved_addresses
  SET is_default = true
  WHERE id = p_address_id AND user_id = v_profile_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_default_address(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_default_address(UUID, UUID) TO authenticated;
