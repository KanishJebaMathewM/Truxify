import express from 'express';
import { registerDeviceToken } from '../controllers/deviceController.js';
import { authenticate } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { registerDeviceSchema } from '../validation/requestSchemas.js';
import { deviceLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// POST /api/devices/register
router.post('/register', authenticate, deviceLimiter, validateBody(registerDeviceSchema), registerDeviceToken);

export default router;
