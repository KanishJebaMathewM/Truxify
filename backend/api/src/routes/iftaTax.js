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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [truckId, waypoints]
 *             properties:
 *               truckId:
 *                 type: string
 *               quarter:
 *                 type: string
 *                 default: Q3
 *                 example: Q3
 *               year:
 *                 type: integer
 *                 default: 2026
 *               waypoints:
 *                 type: array
 *                 description: Ordered GPS waypoints; mileage between consecutive points is attributed to the later point's jurisdiction.
 *                 items:
 *                   type: object
 *                   required: [latitude, longitude]
 *                   properties:
 *                     latitude:
 *                       type: number
 *                       minimum: -90
 *                       maximum: 90
 *                     longitude:
 *                       type: number
 *                       minimum: -180
 *                       maximum: 180
 *                     jurisdictionState:
 *                       type: string
 *                       example: TX
 *               fuelPurchases:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     jurisdictionState:
 *                       type: string
 *                     gallons:
 *                       type: number
 *                       minimum: 0
 *                     taxPaidUSD:
 *                       type: number
 *                       minimum: 0
 *     responses:
 *       200:
 *         description: Quarterly IFTA report
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     truckId:
 *                       type: string
 *                     period:
 *                       type: string
 *                       example: Q3 2026
 *                     summary:
 *                       type: object
 *                       properties:
 *                         totalMilesDriven:
 *                           type: number
 *                         totalGallonsPurchased:
 *                           type: number
 *                         fleetAverageMpg:
 *                           type: number
 *                           nullable: true
 *                           description: null when no fuel was purchased in the period.
 *                     jurisdictionBreakdown:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           jurisdictionState:
 *                             type: string
 *                           totalMilesDriven:
 *                             type: number
 *                           taxableGallonsPurchased:
 *                             type: number
 *                           taxPaidUSD:
 *                             type: number
 *                     generatedAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Missing truckId/waypoints, non-array fuelPurchases, or invalid waypoint/amount values
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Forbidden - ifta:generate-report policy required
 *       500:
 *         description: Failed to generate IFTA report
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
