-- Migration: Secure gps_offline_data RLS
-- Drops insecure authenticated_all policy and restricts access to the row owner.

DROP POLICY IF EXISTS gps_offline_data_authenticated_all ON gps_offline_data;

CREATE POLICY gps_offline_data_owner
  ON gps_offline_data
  FOR ALL
  TO authenticated
  USING ("peerId" = get_profile_id()::text)
  WITH CHECK ("peerId" = get_profile_id()::text);
