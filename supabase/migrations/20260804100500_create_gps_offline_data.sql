-- Migration: Create gps_offline_data table
-- Persists WebRTC offline GPS payloads for the offline-sync feature.

CREATE TABLE IF NOT EXISTS gps_offline_data (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "peerId"  text NOT NULL,
  data      jsonb NOT NULL,
  timestamp bigint NOT NULL,
  synced    boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS gps_offline_data_peer_idx
  ON gps_offline_data ("peerId");

-- Service uses the anon client on behalf of authenticated users.
ALTER TABLE gps_offline_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY gps_offline_data_authenticated_all
  ON gps_offline_data
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
