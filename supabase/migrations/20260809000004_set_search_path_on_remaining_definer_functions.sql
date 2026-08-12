-- Pin search_path on the two SECURITY DEFINER functions that still lack it.
--
-- 20260706075009_secure_rpc_search_path.sql hardened every SECURITY DEFINER
-- function that existed at the time. Two have escaped that guarantee:
--
--   * revoke_tracking_tokens_on_terminal_status() — added in
--     20260716000000_add_public_tracking_tokens.sql, ten days after the
--     hardening migration.
--   * register_device_token(...) — added in
--     20260807000010_register_device_token_tx.sql, the newest migration in the
--     tree.
--
-- A SECURITY DEFINER function runs with the privileges of its owner. Without a
-- pinned search_path it resolves unqualified names against the *caller's*
-- search_path, so a caller who can create objects in a schema earlier on that
-- path can shadow a table or function the body references and have it executed
-- as the owner.
--
-- ALTER FUNCTION is used rather than CREATE OR REPLACE so the bodies are not
-- duplicated here and cannot drift from their defining migrations.

ALTER FUNCTION public.register_device_token(uuid, text, text, jsonb, uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.revoke_tracking_tokens_on_terminal_status()
  SET search_path = public, pg_temp;
