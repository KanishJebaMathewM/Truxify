import { supabase, supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';
import { errorResponse } from '../utils/apiResponse.js';
import { AppError, UnauthorizedError, ValidationError } from '../utils/errors.js';
import notificationService from '../services/notificationService.js';

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
 * Stable installation/device identifier used for FCM token rotation. Nullable —
 * legacy clients that only send an FCM token remain fully supported.
 */
function validateDeviceId(deviceId) {
  if (deviceId === undefined || deviceId === null) return null;
  if (typeof deviceId !== 'string') return 'deviceId must be a string';
  if (deviceId.length < 3 || deviceId.length > 128) return 'deviceId length must be between 3 and 128';
  if (!/^[a-zA-Z0-9\-_.:]+$/.test(deviceId)) return 'deviceId contains invalid characters';
  return null;
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
 * Register / update FCM token for a user device.
 *
 * Idempotent: re-registering the same token re-activates/touches the existing
 * row instead of inserting a duplicate. When a stable `deviceId` is supplied,
 * token rotation updates the existing device row in place and retires the old
 * active row, so a rotating token never accumulates duplicate active records.
 */
export async function registerDeviceToken(req, res, next) {
  try {
    const userId = req.user?.id;
    // Support both 'fcmToken' (original) and 'fcm_token' (new snippet)
    const { fcmToken, fcm_token, platform, device_type, device_model, metadata, deviceId } = req.body;
    
    const finalToken = fcmToken || fcm_token;

    if (!userId) {
      return next(new UnauthorizedError('User not authenticated'));
    }

    const tokenErr = validateFcmToken(finalToken);
    if (tokenErr) {
      return res.status(400).json({ error: tokenErr });
    }

    const platErr = validatePlatform(platform || device_type);
    if (platErr) {
      return next(new ValidationError(platErr));
    }

    const deviceIdErr = validateDeviceId(deviceId);
    if (deviceIdErr) {
      return next(new ValidationError(deviceIdErr));
    }

    const { data: normalizedMetadata, error: metadataErr } = normalizeMetadata(metadata);
    if (metadataErr) {
      return res.status(400).json(
        errorResponse('VALIDATION_ERROR', metadataErr)
      );
    }

    if (!supabaseAdmin) {
      logger.error('[DeviceController] Service-role client unavailable for register_device_token');
      return next(new AppError('Failed to register device', 503));
    }

    const { data: existingDevice, error: lookupError } = await supabaseAdmin
      .from('user_devices')
      .select('user_id')
      .eq('fcm_token', finalToken)
      .maybeSingle();

    if (lookupError) {
      logger.error('[DeviceController] Failed to look up existing device token owner:', lookupError.message);
      return next(new AppError('Failed to register device', 500));
    }

    const previousUserId = existingDevice?.user_id;

    // All operations (upsert user_devices, rotate/retire superseded device rows,
    // clear previous owner's profile, sync current user's profile) run inside a
    // single Postgres transaction via the register_device_token RPC so a partial
    // failure rolls everything back. The RPC is SECURITY DEFINER and EXECUTE is
    // granted to service_role only (the migration revokes it from PUBLIC/anon/
    // authenticated), so it must be invoked through the admin client rather than
    // the shared anon client. It receives the server-verified req.user.id rather
    // than trusting client input.
    const { error: rpcError } = await supabaseAdmin.rpc('register_device_token', {
      p_user_id:      userId,
      p_fcm_token:    finalToken,
      p_platform:     platform || device_type || 'android',
      p_metadata:     normalizedMetadata,
      p_prev_user_id: previousUserId ?? null,
      p_device_id:    deviceId ?? null,
      p_last_seen:    new Date().toISOString(),
      // Pass additional fields if the RPC supports them, otherwise they are ignored
      p_device_model: device_model ?? null, 
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
 *
 * Soft-deactivates ONLY the matching device — the user's other devices stay
 * active. The row is preserved for audit. The profile-level token falls back to
 * another active device when available.
 */
export async function unregisterDeviceToken(req, res, next) {
  try {
    const userId = req.user?.id;
    // Support both 'fcmToken' and 'fcm_token'
    const { fcmToken, fcm_token } = req.body;
    const finalToken = fcmToken || fcm_token;

    if (!userId) {
      return next(new UnauthorizedError('User not authenticated'));
    }

    const tokenErr = validateFcmToken(finalToken);
    if (tokenErr) {
      return res.status(400).json({
        success: false,
        error: tokenErr
      });
    }

    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('unregister_device_token', {
      p_user_id:   userId,
      p_fcm_token: finalToken,
    });

    if (rpcError) {
      logger.error('[DeviceController] Failed to unregister device token from database:', rpcError.message);
      return next(new AppError('Failed to unregister device', 500));
    }

    // If no rows were deleted, the token was not registered for this user
    const deletedCount = Array.isArray(rpcResult) ? rpcResult.length : (rpcResult ?? 0);
    if (deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Device token not found'
      });
    }

    // Query remaining device tokens for this user to fallback
    const { data: remainingDevice, error: remainingError } = await supabase
      .from('user_devices')
      .select('fcm_token')
      .eq('user_id', userId)
      .eq('is_active', true)
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

/**
 * Deactivate every device belonging to the user (e.g. account wipe).
 * Rows are soft-deactivated and preserved, never deleted.
 */
export async function unregisterAllDeviceTokens(userId) {
  const { error } = await supabaseAdmin
    .from('user_devices')
    .update({
      is_active: false,
      deactivated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('is_active', true);
  if (error) {
    logger.error('[DeviceController] Failed to unregister device tokens:', error.message);
    throw error;
  }

  const { error: profileError } = await supabaseAdmin
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
 * Get list of unique registered device platforms (active devices only).
 */
export async function getDevicePlatforms(req, res, next) {
  try {
    const checks = await Promise.all(
      VALID_PLATFORMS.map(async (platform) => {
        const { data, error } = await supabaseAdmin
          .from('user_devices')
          .select('platform')
          .eq('platform', platform)
          .eq('is_active', true)
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

/**
 * Prune stale inactive devices.
 * Removes device records that have been deactivated for longer than 30 days.
 * This keeps the user_devices table clean and prevents accumulation of 
 * permanently-invalid tokens.
 */
export async function pruneDevices(req, res, next) {
  try {
    // Default to 30 days if not specified in query params
    const days = parseInt(req.query.days, 10) || 30;
    
    if (days < 1 || days > 365) {
      return res.status(400).json({
        success: false,
        error: 'Days parameter must be between 1 and 365'
      });
    }

    const result = await notificationService.pruneStaleDevices(days);
    
    return res.status(200).json({ 
      success: true, 
      message: `Successfully pruned ${result.pruned} stale devices`,
      pruned: result.pruned
    });
  } catch (err) {
    logger.error('[DeviceController] Unexpected error in pruneDevices:', err.message);
    return next(new AppError('Failed to prune stale devices', 500));
  }
}

/**
 * Update the authenticated user's current location.
 */
export async function updateLocation(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new UnauthorizedError('User not authenticated'));
    }

    const { latitude, longitude, heading, speed } = req.body;

    const lat = parseFloat(latitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return res.status(400).json({ error: 'latitude must be a valid number between -90 and 90' });
    }

    const lng = parseFloat(longitude);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'longitude must be a valid number between -180 and 180' });
    }

    const parsedHeading = Number.isFinite(parseFloat(heading)) ? parseFloat(heading) : null;
    const parsedSpeed   = Number.isFinite(parseFloat(speed))   ? parseFloat(speed)   : null;

    const { error } = await supabaseAdmin
      .from('user_locations')
      .upsert(
        {
          user_id:    userId,
          latitude:   lat,
          longitude:  lng,
          heading:    parsedHeading,
          speed:      parsedSpeed,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    if (error) {
      logger.error('[DeviceController] Failed to update location:', error.message);
      return next(new AppError('Failed to update location', 500));
    }

    return res.json({ success: true, message: 'Location updated' });
  } catch (err) {
    logger.error('[DeviceController] Unexpected error in updateLocation:', err.message);
    return next(err);
  }
}

// Aliases for route-layer consumers that prefer shorter names
export const registerDevice   = registerDeviceToken;
export const unregisterDevice = unregisterDeviceToken;

export default {
  registerDeviceToken,
  registerDevice,
  unregisterDeviceToken,
  unregisterDevice,
  updateLocation,
  unregisterAllDeviceTokens,
  getDevicePlatforms,
  pruneDevices
};
