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

    const { error } = await supabase.from('user_devices').upsert({
      user_id: userId,
      fcm_token: fcmToken,
      platform: platform || 'android'
    });

    if (error) {
      logger.error('[DeviceController] Failed to register device token in database:', error.message);
      return res.status(500).json({
        error: 'Failed to register device'
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