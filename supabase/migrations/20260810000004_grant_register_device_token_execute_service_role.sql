-- Fix #8938: grant EXECUTE on register_device_token to service_role.
--
-- deviceController.registerDeviceToken invokes the SECURITY DEFINER RPC
-- through supabaseAdmin (the service-role key), but the only grant in the
-- repo targets the `authenticated` role
-- (20260809000000_grant_register_device_token_execute.sql). With EXECUTE
-- revoked from PUBLIC and never granted to service_role, every service-role
-- call still fails with 42501 (permission denied for function
-- register_device_token). This grant matches the intent documented in
-- 20260807000010_register_device_token_tx.sql: only the service-role key may
-- call this function directly.

GRANT EXECUTE ON FUNCTION register_device_token(uuid, text, text, jsonb, uuid) TO service_role;
