import { supabase } from '../config/db.js';
import logger from '../middleware/logger.js';
import { AppError, UnauthorizedError, ValidationError } from '../utils/errors.js';
import { errorResponse } from '../utils/apiResponse.js';

const VALID_PLATFORMS = ['android', 'ios', 'web'];

function validateFcmToken(token) {
  if (!token || typeof token !== 'string') return 'fcmToken must be a non-empty string';
  if (token.length < 10 || token.length > 4096) return 'fcmToken length must be between 10 and 4096';
  // Allow standard FCM v1 token characters including ., %, /, +, =
  if (!/^[a-zA-Z0-9\-_:.%/+=]+$/.test(token)) return 'fcmToken contains invalid characters';
  return null;
}

function validatePlatform(platform) {
  if (!platform) return null;
  return VALID_PLATFORMS.includes(platform) ? null : `Platform must be one of: ${VALID_PLATFORMS.join(', ')}`;
}

/**
 * Normalizes and validates metadata payload.
 * Returns an explicit result structure so user payload keys (e.g. { error: "..." }) 
 * are not confused with validation failures.
 */
function normalizeMetadata(metadata) {
  if (metadata === undefined || metadata === null) {
    return { data: {}, error: null };
  }
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { data: null, error: 'metadata must be an object' };
  }
  const prototype = Object.getPrototypeOf(metadata);
  if (prototype !== Object.prototype && prototype !== null) {
    return { data: null, error: 'metadata must be an object' };
  }
  return { data: metadata, error: null };
}

/**
 * Register / update FCM token for a user device
 */
export async function registerDeviceToken(req, res, next) {
  try {
    const userId = req.user?.id;
    const { fcmToken, platform, metadata } = req.body;

    if (!userId) {
      return next(new UnauthorizedError('User not authenticated'));
    }

    const tokenErr = validateFcmToken(fcmToken);
    if (tokenErr) {
      return res.status(400).json({ error: tokenErr });
    }

    const platErr = validatePlatform(platform);
    if (platErr) {
      return next(new ValidationError(platErr));
    }

    const { data: normalizedMetadata, error: metadataErr } = normalizeMetadata(metadata);
    if (metadataErr) {
      return res.status(400).json(
        errorResponse('VALIDATION_ERROR', metadataErr)
      );
    }

    const { data: existingDevice, error: lookupError } = await supabase
      .from('user_devices')
      .select('user_id')
      .eq('fcm_token', fcmToken)
      .maybeSingle();

    if (lookupError) {
      logger.error('[DeviceController] Failed to look up existing device token owner:', lookupError.message);
      return next(new AppError('Failed to register device', 500));
    }

    const previousUserId = existingDevice?.user_id;

    // All three operations (upsert user_devices, clear previous owner's profile,
    // sync current user's profile) run inside a single Postgres transaction via
    // the register_device_token RPC so a partial failure rolls everything back
    // and leaves no orphaned or desynchronized records.
    const { error: rpcError } = await supabase.rpc('register_device_token', {
      p_user_id:      userId,
      p_fcm_token:    fcmToken,
      p_platform:     platform || 'android',
      p_metadata:     normalizedMetadata,
      p_prev_user_id: previousUserId ?? null,
    });

    if (rpcError) {
      logger.error('[DeviceController] register_device_token RPC failed:', rpcError.message);
      return next(new AppError('Failed to register device', 500));
    }

    return res.json({
      success: true,
      message: 'Device token registered'
    });
  } catch (err) {
    logger.error('[DeviceController] Unexpected error in registerDeviceToken:', err.message);
    return next(err);
  }
}

/**
 * Unregister an FCM token for a user device, e.g. on logout.
 * Updates profiles.fcm_token to fallback to another active device token if available.
 */
export async function unregisterDeviceToken(req, res, next) {
  try {
    const userId = req.user?.id;
    const { fcmToken } = req.body;

    if (!userId) {
      return next(new UnauthorizedError('User not authenticated'));
    }

    const tokenErr = validateFcmToken(fcmToken);
    if (tokenErr) {
      return res.status(400).json({
        success: false,
        error: tokenErr
      });
    }

    const { data: deletedRows, error: deleteError } = await supabase
      .from('user_devices')
      .delete()
      .eq('user_id', userId)
      .eq('fcm_token', fcmToken)
      .select('id');

    if (deleteError) {
      logger.error('[DeviceController] Failed to remove device token from database:', deleteError.message);
      return next(new AppError('Failed to unregister device', 500));
    }

    // Query remaining device tokens for this user to fallback
    const { data: remainingDevice, error: remainingError } = await supabase
      .from('user_devices')
      .select('fcm_token')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (remainingError) {
      logger.error('[DeviceController] Failed to check remaining devices:', remainingError.message);
    }

    const nextToken = remainingDevice?.fcm_token || null;

    const { error: profileSyncError } = await supabase
      .from('profiles')
      .update({
        fcm_token: nextToken,
        fcm_token_updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (profileSyncError) {
      logger.error(
        '[DeviceController] Device token removed but failed to sync profiles.fcm_token:',
        profileSyncError.message
      );
    }

    return res.json({
      success: true,
      message: 'Device token unregistered'
    });
  } catch (err) {
    logger.error('[DeviceController] Unexpected error in unregisterDeviceToken:', err.message);
    return next(err);
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

  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      fcm_token: null,
      fcm_token_updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (profileError) {
    logger.error(
      '[DeviceController] Device tokens removed but failed to clear profiles.fcm_token:',
      profileError.message
    );
  }
}

/**
 * Get list of unique registered device platforms
 */
export async function getDevicePlatforms(req, res, next) {
  try {
    const checks = await Promise.all(
      VALID_PLATFORMS.map(async (platform) => {
        const { data, error } = await supabase
          .from('user_devices')
          .select('platform')
          .eq('platform', platform)
          .limit(1);

        if (error) throw error;
        return data && data.length > 0 ? platform : null;
      })
    );

    const platforms = checks.filter(Boolean);
    return res.json({ platforms });
  } catch (err) {
    logger.error('[DeviceController] Unexpected error in getDevicePlatforms:', err.message);
    return next(err);
  }
}