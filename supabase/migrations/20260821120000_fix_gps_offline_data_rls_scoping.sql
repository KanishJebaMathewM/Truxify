-- Fix P1 security issue: gps_offline_data PUBLIC FOR ALL policy
-- defeats owner-scoped RLS.
--
-- Problem: migration 20260805000060 creates gps_offline_data_service_policy
-- with no TO clause, so it applies to PUBLIC. RLS policies are OR'd, so the
-- PUBLIC allow-all policy wins for any authenticated user, defeating the
-- owner-scoped gps_offline_data_owner policy. Any authenticated user can
-- read/modify/delete any other user's GPS payloads.
--
-- Fix: drop the PUBLIC policy, re-create it scoped to service_role only.
-- Also revoke anon privileges on this table (should never have been granted).

-- Drop the mis-scoped PUBLIC policy
DROP POLICY IF EXISTS gps_offline_data_service_policy ON gps_offline_data;

-- Re-create scoped to service_role only (the WebRTC service uses the
-- service/client key, not the user's JWT)
CREATE POLICY gps_offline_data_service_policy ON gps_offline_data
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Revoke anon access (the table contains sensitive GPS payloads)
REVOKE ALL ON TABLE gps_offline_data FROM anon;
