import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { ValidationError } from '../utils/errors.js';
import { generateIftaReport } from '../services/iftaTax.js';

const router = express.Router();

/**
 * @openapi
 * /api/ifta-tax/generate-report:
 *   post:
 *     tags: [Compliance]
 *     summary: Generate a quarterly IFTA tax report
 *     description: Aggregates GPS waypoint mileage and fuel purchases per jurisdiction.
 *     security:
 *       - BearerAuth: []
 */
router.post(
  '/generate-report',
  authenticate,
  requirePolicy('ifta:generate-report'),
  (req, res) => {
    try {
      const { truckId, quarter, year, waypoints, fuelPurchases } = req.body || {};

      if (!truckId) {
        return res.status(400).json({ error: 'truckId parameter is required.' });
      }

      if (!Array.isArray(waypoints)) {
        return res.status(400).json({ error: 'Array of GPS waypoints is required.' });
      }

      // Previously unchecked: a non-array `fuelPurchases` reached `.forEach` and
      // turned a client mistake into a 500.
      if (fuelPurchases !== undefined && fuelPurchases !== null && !Array.isArray(fuelPurchases)) {
        return res.status(400).json({ error: 'fuelPurchases must be an array.' });
      }

      const report = generateIftaReport({
        truckId,
        quarter,
        year,
        waypoints,
        fuelPurchases
      });

      return res.json({
        success: true,
        data: report
      });
    } catch (error) {
      // Bad telemetry is a client error, not an outage, and reporting it as a
      // 500 hid invalid payloads from monitoring.
      if (error instanceof ValidationError) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to generate IFTA report.' });
    }
  }
);

export default router;
