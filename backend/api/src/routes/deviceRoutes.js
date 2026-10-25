/**
 * @openapi
 * components:
 *   schemas:
 *     DeviceRegisterRequest:
 *       type: object
 *       required:
 *         - token
 *         - platform
 *       properties:
 *         token:
 *           type: string
 *           description: Firebase Cloud Messaging device token
 *         platform:
 *           type: string
 *           enum: [ios, android, web]
 *         deviceId:
 *           type: string
 *           description: Stable installation/device identifier used for FCM token rotation (optional)
 *     DeviceRegisterResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         message:
 *           type: string
 *     DeviceUnregisterRequest:
 *       type: object
 *       required:
 *         - token
 *       properties:
 *         token:
 *           type: string
 *           description: FCM token to unregister
 */
// backend/api/src/routes/deviceRoutes.js (Excerpt)

/**
 * @route GET /api/devices/platforms
 * @desc Retrieve a list of unique registered device platforms
 * @access Private / Admin
 */
router.get('/platforms', authenticate, async (req, res) => {
  try {
    // FIX/FEATURE: Query registered platforms from user_devices per issue #2361
    const { data, error } = await supabase
      .from('user_devices')
      .select('platform')
      .not('platform', 'is', null);

    if (error) {
      logger.error({ err: error }, '[deviceRoutes] Failed to fetch device platforms from database');
      return res.status(500).json({
        success: false,
        error: `Failed to retrieve platforms: ${error.message}`,
      });
    }

    // Deduplicate platform types (e.g., ['android', 'ios', 'web'])
    const uniquePlatforms = [...new Set((data || []).map((row) => row.platform))];

    return res.status(200).json({
      success: true,
      count: uniquePlatforms.length,
      platforms: uniquePlatforms,
    });
  } catch (err) {
    logger.error({ err }, '[deviceRoutes] Unexpected exception in GET /platforms');
    return res.status(500).json({
      success: false,
      error: `Internal server error: ${err.message}`,
    });
  }
});
import express from 'express';
import { 
  registerDeviceToken, 
  unregisterDeviceToken, 
  getDevicePlatforms,
  pruneDevices,
  syncLocations
} from '../controllers/deviceController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { registerDeviceSchema, unregisterDeviceSchema } from '../validation/requestSchemas.js';
import { deviceLimiter } from '../middleware/rateLimiter.js';
// backend/api/src/routes/deviceRoutes.js (Excerpt)

import { Router } from 'express';
import { getUniquePlatforms } from '../services/deviceService.js';
import { authenticate } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/devices/platforms
 * Returns a list of unique registered device platforms.
 */
router.get('/platforms', authenticate, async (req, res) => {
  try {
    const result = await getUniquePlatforms();

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error,
      });
    }

    return res.status(200).json({
      success: true,
      platforms: result.platforms,
    });
  } catch (err) {
    logger.error({ err }, '[deviceRoutes] Error in GET /api/devices/platforms');
    return res.status(500).json({
      success: false,
      error: 'Internal server error while fetching platforms',
    });
  }
});

export default router;
const router = express.Router();

/**
 * @openapi
 * /api/devices/register:
 *   post:
 *     tags: [Devices]
 *     summary: Register a device for push notifications
 *     description: Registers a device's FCM token and platform for push notification delivery. Rate-limited per device.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DeviceRegisterRequest'
 *     responses:
 *       200:
 *         description: Device registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeviceRegisterResponse'
 *       400:
 *         description: Validation error
 *       429:
 *         description: Rate limited
 */
// Device token validation helper
function validateDeviceToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Device token is required and must be a string' };
  }
  if (token.length < 10 || token.length > 1024) {
    return { valid: false, error: 'Device token length must be between 10 and 1024 characters' };
  }
  return { valid: true };
}

// POST /api/devices/register
router.post('/register', authenticate, deviceLimiter, validateBody(registerDeviceSchema), registerDeviceToken);

/**
 * @openapi
 * /api/devices/unregister:
 *   delete:
 *     tags: [Devices]
 *     summary: Unregister a device from push notifications
 *     description: Removes a device's FCM token so it stops receiving push notifications. Should be called on logout.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DeviceUnregisterRequest'
 *     responses:
 *       200:
 *         description: Device unregistered
 *       400:
 *         description: Validation error
 */
router.delete('/unregister', authenticate, deviceLimiter, validateBody(unregisterDeviceSchema), unregisterDeviceToken);
router.post('/unregister', authenticate, deviceLimiter, validateBody(unregisterDeviceSchema), unregisterDeviceToken);

// GET /api/devices/platforms
router.get('/platforms', authenticate, getDevicePlatforms);

// POST /api/devices/locations/sync
router.post('/locations/sync', authenticate, syncLocations);

/**
 * @openapi
 * /api/devices/prune:
 *   post:
 *     tags: [Devices]
 *     summary: Prune stale inactive devices
 *     description: Removes device records that have been deactivated for longer than 30 days (or specified days). Admin/Maintenance operation.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
 *         description: Number of days after deactivation before pruning
 *     responses:
 *       200:
 *         description: Stale devices pruned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 pruned:
 *                   type: integer
 *                   description: Number of devices removed
 *       400:
 *         description: Invalid days parameter
 *       500:
 *         description: Server error
 */
router.post('/prune', authenticate, requireRole(['admin']), pruneDevices);

export default router;
