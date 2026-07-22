import { supabase } from '../config/db.js';
import logger from '../middleware/logger.js';

const VALID_PLATFORMS = ['android', 'ios', 'web'];

function validateFcmToken(token) {
  if (!token || typeof token !== 'string') return 'fcmToken must be a non-empty string';
  if (token.length < 10 || token.length > 4096) return 'fcmToken length must be between 10 and 4096';
  if (!/^[a-zA-Z0-9\-_:]+$/.test(token)) return 'fcmToken contains invalid characters';
  return null;
}

function validatePlatform(platform) {
  if (!platform) return null;
  return VALID_PLATFORMS.includes(platform) ? null : `Platform must be one of: ${VALID_PLATFORMS.join(', ')}`;
}

function normalizeMetadata(metadata) {
  if (metadata === undefined || metadata === null) return {};
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { error: 'metadata must be an object' };
  }
  const prototype = Object.getPrototypeOf(metadata);
  if (prototype !== Object.prototype && prototype !== null) {
    return { error: 'metadata must be an object' };
  }
  return metadata;
}

/**
 * Register / update FCM token for a user device
 */
export async function registerDeviceToken(req, res) {
  try {
    const userId = req.user?.id;
    const { fcmToken, platform, metadata } = req.body;

    if (!userId) {
      return res.status(401).json({
        error: 'User not authenticated'
      });
    }

    const tokenErr = validateFcmToken(fcmToken);
    if (tokenErr) {
      return res.status(400).json({ error: tokenErr });
    }

    const platErr = validatePlatform(platform);
    if (platErr) {
      return res.status(400).json({ error: platErr });
    }

    const normalizedMetadata = normalizeMetadata(metadata);
    if (normalizedMetadata.error) {
      return res.status(400).json({ error: normalizedMetadata.error });
    }

    const tokenUpdatedAt = new Date().toISOString();
    const { data: existingDevice, error: lookupError } = await supabase
      .from('user_devices')
      .select('user_id')
      .eq('fcm_token', fcmToken)
      .maybeSingle();

    if (lookupError) {
      logger.error('[DeviceController] Failed to look up existing device token owner:', lookupError.message);
      return res.status(500).json({
        error: 'Failed to register device'
      });
    }

    const previousUserId = existingDevice?.user_id;

    const { error } = await supabase.from('user_devices').upsert(
      {
        user_id: userId,
        fcm_token: fcmToken,
        platform: platform || 'android',
        metadata: normalizedMetadata
      },
      { onConflict: 'fcm_token' }
    );

    if (error) {
      logger.error('[DeviceController] Failed to register device token in database:', error.message);
      return res.status(500).json({
        error: 'Failed to register device'
      });
    }

    if (previousUserId && previousUserId !== userId) {
      const { error: staleProfileError } = await supabase
        .from('profiles')
        .update({
          fcm_token: null,
          fcm_token_updated_at: tokenUpdatedAt,
        })
        .eq('id', previousUserId)
        .eq('fcm_token', fcmToken);

      if (staleProfileError) {
        logger.error(
          '[DeviceController] Device token saved but failed to clear previous profiles.fcm_token:',
          staleProfileError.message
        );
      }
    }

    const { error: profileSyncError } = await supabase
      .from('profiles')
      .update({
        fcm_token: fcmToken,
        fcm_token_updated_at: tokenUpdatedAt,
      })
      .eq('id', userId);

    if (profileSyncError) {
      logger.error(
        '[DeviceController] Device token saved but failed to sync profiles.fcm_token:',
        profileSyncError.message
      );
      return res.status(500).json({
        error: 'Failed to sync device token to profile'
      });
    }

    return res.json({
      success: true,
      message: 'Device token registered'
    });
  } catch (err) {
    logger.error('[DeviceController] Unexpected error in registerDeviceToken:', err.message);
    return res.status(500).json({
      error: 'An unexpected error occurred'
    });
  }
}

/**
 * Unregister an FCM token for a user device, e.g. on logout.
 * Removes the token from user_devices so the signed-out device stops
 * receiving push notifications, and clears profiles.fcm_token when it
 * still points at the same token.
 */
export async function unregisterDeviceToken(req, res) {
  try {
    const userId = req.user?.id;
    const { fcmToken } = req.body;

    if (!userId) {
      return res.status(401).json({
        error: 'User not authenticated'
      });
    }

    const tokenErr = validateFcmToken(fcmToken);
    if (tokenErr) {
      return res.status(400).json({
        error: tokenErr
      });
    }

    const { error: deleteError } = await supabase
      .from('user_devices')
      .delete()
      .eq('user_id', userId)
      .eq('fcm_token', fcmToken);

    if (deleteError) {
      logger.error('[DeviceController] Failed to remove device token from database:', deleteError.message);
      return res.status(500).json({
        error: 'Failed to unregister device'
      });
    }

    const { error: profileClearError } = await supabase
      .from('profiles')
      .update({
        fcm_token: null,
        fcm_token_updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .eq('fcm_token', fcmToken);

    if (profileClearError) {
      logger.error(
        '[DeviceController] Device token removed but failed to clear profiles.fcm_token:',
        profileClearError.message
      );
    }

    return res.json({
      success: true,
      message: 'Device token unregistered'
    });
  } catch (err) {
    logger.error('[DeviceController] Unexpected error in unregisterDeviceToken:', err.message);
    return res.status(500).json({
      error: 'An unexpected error occurred'
    });
  }
}

export async function unregisterAllDeviceTokens(userId) {
  const { error } = await supabase
    .from('user_devices')
    .delete()
    .eq('user_id', userId);
  if (error) {
    logger.error('[DeviceController] Failed to unregister device tokens:', error.message);
    throw error;
  }
}

/**
 * Get list of unique registered device platforms
 */
export async function getDevicePlatforms(req, res) {
  try {
    const { data, error } = await supabase
      .from('user_devices')
      .select('platform');

    if (error) {
      logger.error('[DeviceController] Failed to query device platforms:', error.message);
      return res.status(500).json({ error: 'Failed to retrieve platforms' });
    }

    const platforms = [...new Set((data || []).map((d) => d.platform).filter(Boolean))];
    return res.json({ platforms });
  } catch (err) {
    logger.error('[DeviceController] Unexpected error in getDevicePlatforms:', err.message);
    return res.status(500).json({ error: 'An unexpected error occurred' });
  }
}
