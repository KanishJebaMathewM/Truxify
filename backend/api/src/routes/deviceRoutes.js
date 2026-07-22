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

import express from 'express';
import { registerDeviceToken, unregisterDeviceToken, getDevicePlatforms } from '../controllers/deviceController.js';
import { authenticate } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { registerDeviceSchema, unregisterDeviceSchema } from '../validation/requestSchemas.js';
import { deviceLimiter } from '../middleware/rateLimiter.js';

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

// GET /api/devices/platforms
router.get('/platforms', authenticate, getDevicePlatforms);

export default router;

// Resolves #2058: Rate limit device registration
