-- Migration: Add set_default_address RPC (fixes #1359)
-- setDefault previously cleared all defaults in one call, then set the new
-- default in a second, separate call. If the second call failed (stale/
-- deleted addressId, RLS block, network error), every address was left
-- non-default with no replacement. This wraps both writes in a single
-- SECURITY DEFINER function so they succeed or fail together.
-- supabase/migrations/20260804000000_add_set_default_address_rpc.sql (Updated)

CREATE OR REPLACE FUNCTION set_default_address(p_address_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_profile_id UUID;
BEGIN
    -- Derive canonical profiles.id using the RLS helper function
    v_profile_id := get_profile_id();

    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION 'User profile not found for current session';
    -- Unset previous default addresses for this profile
    UPDATE saved_addresses
    SET is_default = FALSE
    WHERE user_id = v_profile_id;

    -- Set the specified address as default
    UPDATE saved_addresses
    SET is_default = TRUE
    WHERE id = p_address_id AND user_id = v_profile_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Address not found or unauthorized';
    END IF;

    RETURN TRUE;
END;
$$;
CREATE OR REPLACE FUNCTION set_default_address(
  p_address_id UUID,
  p_user_id    UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  -- Verify the caller IS the user whose addresses are being modified.
  -- auth.uid() is NULL for unauthenticated calls, and NULL <> x is NULL
  -- (not TRUE), so this must be a null-safe check to actually block them.
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: you can only modify your own addresses';
  END IF;

  -- Lock and confirm the target address belongs to this user before
  -- touching anything else
  SELECT EXISTS(
    SELECT 1 FROM saved_addresses
    WHERE id = p_address_id
      AND user_id = p_user_id
    FOR UPDATE
  ) INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'Address not found';
  END IF;

  UPDATE saved_addresses
    SET is_default = false
    WHERE user_id = p_user_id
      AND id <> p_address_id;

  UPDATE saved_addresses
    SET is_default = true
    WHERE id = p_address_id
      AND user_id = p_user_id;
END;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation;
-- granting to authenticated afterward does not revoke that. Revoke first.
REVOKE EXECUTE ON FUNCTION set_default_address(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_default_address(UUID, UUID) TO authenticated;
