import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { getShipmentDetails } from '../controllers/shipmentController.js';

const router = express.Router();

// ──────────────────────────────────────────────────────────────────────────
// GET /api/v1/shipment/details
// Authenticated — fetches shipment details, ensuring user is authorized.
// ──────────────────────────────────────────────────────────────────────────
router.get('/details', authenticate, userLimiter, getShipmentDetails);

export default router;
