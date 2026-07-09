import express from 'express';
import { registerDeviceToken, unregisterDeviceToken, getDevicePlatforms } from '../controllers/deviceController.js';
import { authenticate } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { registerDeviceSchema, unregisterDeviceSchema } from '../validation/requestSchemas.js';
import { deviceLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

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

// DELETE /api/devices/unregister
// Called on logout so a signed-out device stops receiving push notifications.
router.delete('/unregister', authenticate, deviceLimiter, validateBody(unregisterDeviceSchema), unregisterDeviceToken);

// GET /api/devices/platforms
router.get('/platforms', authenticate, getDevicePlatforms);

export default router;

// Resolves #2058: Rate limit device registration
