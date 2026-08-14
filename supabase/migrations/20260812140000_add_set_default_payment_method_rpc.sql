-- Migration: Add set_default_payment_method RPC (fixes #11427)
-- setDefault and add(isDefault:true) each cleared every default in one call
-- and then set the new default in a separate call. Between those two calls there
-- was a window with no default, and neither operation was transactional, so two
-- concurrent writes could each clear-then-set and leave two rows default=true.
-- This wraps both writes in a single SECURITY DEFINER function so they succeed
-- or fail together, and adds a partial unique index as defense in depth so the
-- database itself never allows more than one default per user.

CREATE OR REPLACE FUNCTION set_default_payment_method(
  p_user_id  UUID,
  p_method_id UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  -- Verify the caller IS the user whose payment methods are being modified.
  -- auth.uid() is NULL for unauthenticated calls, and NULL <> x is NULL
  -- (not TRUE), so this must be a null-safe check to actually block them.
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: you can only modify your own payment methods';
  END IF;

  -- Lock and confirm the target method belongs to this user before
  -- touching anything else.
  SELECT EXISTS(
    SELECT 1 FROM payment_methods
    WHERE id = p_method_id
      AND user_id = p_user_id
    FOR UPDATE
  ) INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'Payment method not found';
  END IF;

  UPDATE payment_methods
    SET is_default = false
    WHERE user_id = p_user_id
      AND id <> p_method_id;

  UPDATE payment_methods
    SET is_default = true
    WHERE id = p_method_id
      AND user_id = p_user_id;
END;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation;
-- granting to authenticated afterward does not revoke that. Revoke first.
REVOKE EXECUTE ON FUNCTION set_default_payment_method(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_default_payment_method(UUID, UUID) TO authenticated;

-- Defense in depth: guarantee at most one default per user at the database
-- level. A partial unique index only indexes the rows where is_default is
-- true, so exactly one such row per user_id may exist.
DROP INDEX IF EXISTS payment_methods_single_default_per_user;
CREATE UNIQUE INDEX payment_methods_single_default_per_user
  ON payment_methods (user_id)
  WHERE is_default;
