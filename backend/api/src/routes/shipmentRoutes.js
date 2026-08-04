import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { getShipmentDetails } from '../controllers/shipmentController.js';
import { globalLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// ──────────────────────────────────────────────────────────────────────────
// GET /api/v1/shipment/details
// Authenticated — fetches shipment details, ensuring user is authorized.
// ──────────────────────────────────────────────────────────────────────────
router.get('/details', authenticate, globalLimiter, getShipmentDetails);

export default router;
