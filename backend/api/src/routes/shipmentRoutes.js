
/**
 * @fileoverview shipmentRoutes.js
 *
 * Provides a unified shipment details endpoint that aggregates data from multiple
 * internal services (order, driver, tracking) into a single API response.
 *
 * PRIMARY ENDPOINT: GET /api/v1/shipment/details
 *   Fetches comprehensive shipment information for an authenticated user.
 *   The endpoint aggregates:
 *     - Order details (pickup/drop, cargo, pricing)
 *     - Driver information (current location, contact, vehicle)
 *     - Live tracking data (real-time position if tracking is active)
 *
 *   Authorization: The authenticated user must be associated with the shipment
 *   (as shipper or driver) to view details. The controller delegates all
 *   authorization checks to the underlying repository methods.
 *
 * @module routes/shipmentRoutes
 */

import express from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { getShipmentDetails } from '../controllers/shipmentController.js';
import { globalLimiter } from '../middleware/rateLimiter.js';
import { validateQuery } from '../middleware/validate.js';

const router = express.Router();

const shipmentDetailsQuerySchema = z.object({
  // orders.id is a UUID. Forwarding an arbitrary string to PostgREST turns a
  // malformed client request into a database error and a 500; validate the
  // shape here and make the parameter required to match the controller.
  shipmentId: z.string().uuid(),
}).strict();

// ──────────────────────────────────────────────────────────────────────────
// GET /api/v1/shipment/details
// Authenticated — fetches shipment details, ensuring user is authorized.
// ──────────────────────────────────────────────────────────────────────────
router.get(
  '/details',
  authenticate,
  globalLimiter,
  validateQuery(shipmentDetailsQuerySchema),
  getShipmentDetails,
);

export default router;
