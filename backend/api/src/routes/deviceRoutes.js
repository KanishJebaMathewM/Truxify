import express from 'express';
import { registerDeviceToken, unregisterDeviceToken } from '../controllers/deviceController.js';
import { authenticate } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { registerDeviceSchema, unregisterDeviceSchema } from '../validation/requestSchemas.js';
import { deviceLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// POST /api/devices/register
router.post('/register', authenticate, deviceLimiter, validateBody(registerDeviceSchema), registerDeviceToken);

// DELETE /api/devices/unregister
// Called on logout so a signed-out device stops receiving push notifications.
router.delete('/unregister', authenticate, deviceLimiter, validateBody(unregisterDeviceSchema), unregisterDeviceToken);

export default router;
