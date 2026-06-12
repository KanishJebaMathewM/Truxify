import express from 'express';
import { registerDeviceToken } from '../controllers/deviceController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// POST /api/devices/register
router.post('/register', authenticate, registerDeviceToken);

export default router;