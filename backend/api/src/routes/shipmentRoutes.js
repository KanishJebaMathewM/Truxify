import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { getShipmentDetails } from '../controllers/shipmentController.js';

const router = express.Router();

router.get('/details', authenticate, userLimiter, getShipmentDetails);

export default router;
