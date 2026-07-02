import { supabase } from '../config/db.js';
import logger from '../middleware/logger.js';

/**
 * Register / update FCM token for a user device
 */
export async function registerDeviceToken(req, res) {
  try {
    const userId = req.user?.id;
    const { fcmToken, platform } = req.body;

    if (!userId) {
      return res.status(401).json({
        error: 'User not authenticated'
      });
    }

    if (!fcmToken) {
      return res.status(400).json({
        error: 'fcmToken is required'
      });
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
        platform: platform || 'android'
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
