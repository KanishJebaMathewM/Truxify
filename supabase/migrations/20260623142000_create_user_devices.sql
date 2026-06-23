-- Migration: Create user_devices table
-- Tracks FCM tokens per user device for push notifications.

CREATE TABLE IF NOT EXISTS user_devices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  fcm_token   text UNIQUE NOT NULL,
  platform    text NOT NULL DEFAULT 'android',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON user_devices (user_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_fcm_token ON user_devices (fcm_token);

ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Service role full access on user_devices" ON user_devices;
CREATE POLICY "Service role full access on user_devices"
  ON user_devices FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users access own user_devices" ON user_devices;
CREATE POLICY "Users access own user_devices"
  ON user_devices FOR ALL TO authenticated
  USING (user_id = get_profile_id())
  WITH CHECK (user_id = get_profile_id());

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trg_user_devices_updated_at ON user_devices;
CREATE TRIGGER trg_user_devices_updated_at
  BEFORE UPDATE ON user_devices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
