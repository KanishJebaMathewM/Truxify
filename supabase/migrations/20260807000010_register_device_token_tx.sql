-- Migration: atomic register_device_token RPC
-- Wraps the three non-atomic operations in deviceController.registerDeviceToken
-- into a single Postgres function so a partial failure rolls everything back.
--
-- Operations (in order):
--   1. Upsert user_devices (fcm_token is unique conflict key)
--   2. Clear fcm_token on the previous owner's profile (if the token moved)
--   3. Set fcm_token on the current user's profile
--
-- All three run inside a single transaction; any error aborts all of them.

CREATE OR REPLACE FUNCTION register_device_token(
  p_user_id        uuid,
  p_fcm_token      text,
  p_platform       text,
  p_metadata       jsonb,
  p_prev_user_id   uuid          -- NULL when the token is brand new
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  -- 1. Upsert into user_devices
  INSERT INTO user_devices (user_id, fcm_token, platform, metadata)
  VALUES (p_user_id, p_fcm_token, p_platform, p_metadata)
  ON CONFLICT (fcm_token)
  DO UPDATE SET
    user_id  = EXCLUDED.user_id,
    platform = EXCLUDED.platform,
    metadata = EXCLUDED.metadata;

  -- 2. Clear the token from the previous owner's profile (token reuse / device transfer)
  IF p_prev_user_id IS NOT NULL AND p_prev_user_id <> p_user_id THEN
    UPDATE profiles
    SET fcm_token            = NULL,
        fcm_token_updated_at = v_now
    WHERE id        = p_prev_user_id
      AND fcm_token = p_fcm_token;
  END IF;

  -- 3. Sync the token to the current user's profile
  UPDATE profiles
  SET fcm_token            = p_fcm_token,
      fcm_token_updated_at = v_now
  WHERE id = p_user_id;
END;
$$;

-- Only the service-role key may call this function directly.
REVOKE EXECUTE ON FUNCTION register_device_token(uuid, text, text, jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION register_device_token(uuid, text, text, jsonb, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION register_device_token(uuid, text, text, jsonb, uuid) FROM authenticated;
