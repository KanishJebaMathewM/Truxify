-- Add metadata column to user_devices.
-- deviceController.registerDeviceToken has always upserted a `metadata`
-- field, but the column was never created, so every device registration
-- failed with a PostgREST "unknown column" error (500).

ALTER TABLE user_devices
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;