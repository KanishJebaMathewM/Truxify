-- Migration: restore EXECUTE on register_device_token for the authenticated role
-- ============================================================================
-- deviceController.registerDeviceToken calls this SECURITY DEFINER RPC through
-- the anon-key (supabase) client, which presents the `authenticated` role when a
-- logged-in user's JWT is attached. The original migration
-- (20260807000010_register_device_token_tx.sql) revoked EXECUTE from PUBLIC,
-- anon and authenticated without ever re-granting it to the role the API uses,
-- so every FCM device registration failed with a PostgREST permission error
-- (PGRST203) and device tokens were never stored.
--
-- Granting EXECUTE to `authenticated` lets the function run as its definer
-- (SECURITY DEFINER) so it can still mutate user_devices / profiles on the
-- caller's behalf while remaining invisible to the public `anon` role.
-- ============================================================================

GRANT EXECUTE ON FUNCTION register_device_token(uuid, text, text, jsonb, uuid) TO authenticated;
