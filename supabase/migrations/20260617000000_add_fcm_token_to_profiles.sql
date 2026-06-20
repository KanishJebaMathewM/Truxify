-- Migration: Add FCM token fields to profiles table
-- Required for Firebase Cloud Messaging push notification delivery.
-- Both columns are nullable — existing rows are unaffected.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS fcm_token           TEXT,
  ADD COLUMN IF NOT EXISTS fcm_token_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.fcm_token            IS 'Firebase Cloud Messaging device token for push notification delivery.';
COMMENT ON COLUMN profiles.fcm_token_updated_at IS 'Timestamp of the last FCM token registration or update.';
