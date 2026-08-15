-- Migration: multi-device FCM fan-out + device lifecycle support
--
-- Extends user_devices so it can act as the PRIMARY device registry for push
-- delivery:
--   * device_id   — stable installation/device identifier used for token
--                   rotation (a device that rotates its FCM token keeps ONE
--                   active row instead of accumulating duplicates). Nullable
--                   for legacy clients that only send an FCM token.
--   * is_active   — lifecycle flag. Only active devices are fan-out targets.
--   * deactivated_at — when the device left the active set (unregister,
--                   invalid token, stale-device pruning). Rows are preserved
--                   for auditability; records are never silently deleted.
--   * last_seen   — last registration/delivery touchpoint used by the
--                   stale-device policy. Never prunes recently active devices.
--
-- Also replaces register_device_token with a version that supports device-id
-- based rotation, and adds unregister_device_token which soft-deactivates a
-- single device without affecting the user's other devices.

-- ── 1. Lifecycle columns ────────────────────────────────────────────────────
ALTER TABLE user_devices
  ADD COLUMN IF NOT EXISTS device_id      text,
  ADD COLUMN IF NOT EXISTS is_active      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen      timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN user_devices.device_id      IS 'Stable installation/device identifier used to rotate FCM tokens without duplicating device rows. Nullable for legacy clients.';
COMMENT ON COLUMN user_devices.is_active      IS 'Whether the device may receive push notifications.';
COMMENT ON COLUMN user_devices.deactivated_at IS 'When the device was deactivated (unregister / invalid token / stale pruning). Row is retained for audit.';
COMMENT ON COLUMN user_devices.last_seen      IS 'Last registration or successful delivery time; drives stale-device pruning.';

-- ── 2. Indexes ─────────────────────────────────────────────────────────────
-- Hot path for fan-out: active devices of one user.
CREATE INDEX IF NOT EXISTS idx_user_devices_user_active
  ON user_devices (user_id, is_active);

-- Stale-device sweep: active rows ordered by last activity.
CREATE INDEX IF NOT EXISTS idx_user_devices_active_last_seen
  ON user_devices (is_active, last_seen)
  WHERE is_active;

-- Rotation identity: exactly ONE active row per (user, device). Retired rows
-- keep their history; the partial predicate scopes uniqueness to live rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_devices_active_device
  ON user_devices (user_id, device_id)
  WHERE device_id IS NOT NULL AND is_active;

-- ── 3. register_device_token v2 (rotation aware) ───────────────────────────
DROP FUNCTION IF EXISTS register_device_token(uuid, text, text, jsonb, uuid);

CREATE OR REPLACE FUNCTION register_device_token(
  p_user_id        uuid,
  p_fcm_token      text,
  p_platform       text,
  p_metadata       jsonb,
  p_prev_user_id   uuid,          -- NULL when the token is brand new
  p_device_id      text,          -- stable installation id; NULL for legacy clients
  p_last_seen      timestamptz    -- NULL → now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now        timestamptz := now();
  v_last_seen  timestamptz := COALESCE(p_last_seen, now());
BEGIN
  -- 1. Token rotation: if the client identifies a stable device and an ACTIVE
  --    row already exists for this (user, device) holding a DIFFERENT token,
  --    retire that row first so the (user, device) active-unique index never
  --    blocks the new registration and no duplicate active rows accumulate.
  --    The retired row keeps its token and history for auditability.
  IF p_device_id IS NOT NULL THEN
    UPDATE user_devices
       SET is_active      = false,
           deactivated_at = v_now,
           updated_at     = v_now
     WHERE user_id    = p_user_id
       AND device_id  = p_device_id
       AND fcm_token  <> p_fcm_token
       AND is_active;
  END IF;

  -- 2. Upsert by token (token remains the globally-unique identity). This is
  --    idempotent: re-registering the same token re-activates/touches the row
  --    instead of inserting a duplicate. Token reuse across users moves the
  --    row to the current user (existing device-transfer semantics).
  INSERT INTO user_devices (user_id, fcm_token, platform, metadata, device_id,
                            is_active, deactivated_at, last_seen, updated_at)
  VALUES (p_user_id, p_fcm_token, p_platform, p_metadata, p_device_id,
          true, NULL, v_last_seen, v_now)
  ON CONFLICT (fcm_token) DO UPDATE SET
    user_id         = EXCLUDED.user_id,
    platform        = EXCLUDED.platform,
    metadata        = EXCLUDED.metadata,
    device_id       = EXCLUDED.device_id,
    is_active       = true,
    deactivated_at  = NULL,
    last_seen       = EXCLUDED.last_seen,
    updated_at      = v_now;

  -- 3. Clear the token from the previous owner's profile (token reuse / device transfer)
  IF p_prev_user_id IS NOT NULL AND p_prev_user_id <> p_user_id THEN
    UPDATE profiles
       SET fcm_token            = NULL,
           fcm_token_updated_at = v_now
     WHERE id        = p_prev_user_id
       AND fcm_token = p_fcm_token;
  END IF;

  -- 4. Sync the token to the current user's profile (backward compatibility)
  UPDATE profiles
     SET fcm_token            = p_fcm_token,
         fcm_token_updated_at = v_now
   WHERE id = p_user_id;
END;
$$;

-- Only the service-role key may call this function directly.
REVOKE EXECUTE ON FUNCTION register_device_token(uuid, text, text, jsonb, uuid, text, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION register_device_token(uuid, text, text, jsonb, uuid, text, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION register_device_token(uuid, text, text, jsonb, uuid, text, timestamptz) FROM authenticated;

-- ── 4. unregister_device_token (soft deactivate, scoped to one device) ──────
CREATE OR REPLACE FUNCTION unregister_device_token(
  p_user_id   uuid,
  p_fcm_token text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now         timestamptz := now();
  v_next_token  text;
BEGIN
  -- 1. Soft-deactivate ONLY the targeted device. Other devices of the same
  --    user remain active and keep receiving notifications.
  UPDATE user_devices
     SET is_active      = false,
         deactivated_at = v_now,
         updated_at     = v_now
   WHERE user_id   = p_user_id
     AND fcm_token = p_fcm_token;

  -- 2. If the backward-compatible profile token pointed at the removed device,
  --    fall back to any remaining active device token, else clear it.
  SELECT d.fcm_token INTO v_next_token
    FROM user_devices d
   WHERE d.user_id   = p_user_id
     AND d.is_active = true
   LIMIT 1;

  UPDATE profiles
     SET fcm_token            = CASE WHEN fcm_token = p_fcm_token
                                     THEN v_next_token
                                     ELSE fcm_token
                                END,
         fcm_token_updated_at = v_now
   WHERE id = p_user_id;
END;
$$;

-- Only the service-role key may call this function directly.
REVOKE EXECUTE ON FUNCTION unregister_device_token(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION unregister_device_token(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION unregister_device_token(uuid, text) FROM authenticated;
