import express from 'express';
import { tireAnalyticsService } from '../services/tireAnalyticsService.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

export const MAX_TIRES_PER_TRUCK = 18; // 18-wheeler maximum standard tire positions
export const ALLOWED_TIRE_ROLES = Object.freeze(['driver', 'carrier', 'mechanic', 'admin']);
export const TRUCK_ID_REGEX = /^[a-zA-Z0-9_\-:.]{1,64}$/;

/**
 * Validates truck identifier syntax.
 */
export const isValidTruckId = (truckId) => {
  return typeof truckId === 'string' && TRUCK_ID_REGEX.test(truckId.trim());
};

/**
 * Validates individual TPMS sensor telemetry reading.
 */
export const isValidTpmsReading = (reading) => {
  if (!reading || typeof reading !== 'object') return false;
  const { position, pressurePsi, tempC, mileageKm } = reading;

  if (typeof position !== 'string' || position.trim().length === 0 || position.trim().length > 10) return false;
  if (typeof pressurePsi !== 'number' || !Number.isFinite(pressurePsi) || pressurePsi < 10 || pressurePsi > 200) return false;
  if (typeof tempC !== 'number' || !Number.isFinite(tempC) || tempC < -40 || tempC > 150) return false;
  if (mileageKm !== undefined && (typeof mileageKm !== 'number' || !Number.isFinite(mileageKm) || mileageKm < 0 || mileageKm > 2000000)) return false;

  return true;
};

/**
 * @openapi
 * components:
 *   schemas:
 *     TireAnalyticsReading:
 *       type: object
 *       required:
 *         - position
 *         - pressurePsi
 *         - tempC
 *       properties:
 *         position:
 *           type: string
 *           example: FL
 *         pressurePsi:
 *           type: number
 *           description: Tire pressure in PSI.
 *           example: 105
 *         tempC:
 *           type: number
 *           description: Tire temperature in degrees Celsius.
 *           example: 42
 *         mileageKm:
 *           type: number
 *           minimum: 0
 *           example: 45000
 *     TireAnalyticsReport:
 *       type: object
 *       required:
 *         - ownerId
 *         - truckId
 *         - overallHealth
 *         - tires
 *         - evaluatedAt
 *       properties:
 *         ownerId:
 *           type: string
 *           example: 9a1b2c3d
 *         truckId:
 *           type: string
 *           example: TRUCK-101
 *         overallHealth:
 *           type: string
 *           enum:
 *             - OPERATIONAL
 *             - CRITICAL_ATTENTION_REQUIRED
 *         tires:
 *           type: array
 *           items:
 *             type: object
 *             required:
 *               - position
 *               - pressurePsi
 *               - tempC
 *               - wearPercent
 *               - remainingLifeKm
 *               - alertLevel
 *               - recommendation
 *             properties:
 *               position:
 *                 type: string
 *               pressurePsi:
 *                 type: number
 *               tempC:
 *                 type: number
 *               wearPercent:
 *                 type: number
 *               remainingLifeKm:
 *                 type: integer
 *               alertLevel:
 *                 type: string
 *                 enum:
 *                   - NORMAL
 *                   - WARNING
 *                   - CRITICAL
 *               recommendation:
 *                 type: string
 *         evaluatedAt:
 *           type: string
 *           format: date-time
 */



/**
 * POST /api/tire-analytics/analyze
 * Processes TPMS data to predict tire wear and safety alerts.
 * Restricted to drivers, carriers, mechanics, and admins.
 */
/**
 * @openapi
 * /api/tire-analytics/analyze:
 *   post:
 *     tags:
 *       - Tire Analytics
 *     summary: Analyze TPMS readings
 *     description: Processes TPMS telemetry and returns tire wear and safety analytics.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - truck_id
 *               - tpms_readings
 *             properties:
 *               truck_id:
 *                 type: string
 *                 example: TRUCK-101
 *               tpms_readings:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   $ref: '#/components/schemas/TireAnalyticsReading'
 *           example:
 *             truck_id: TRUCK-101
 *             tpms_readings:
 *               - position: FL
 *                 pressurePsi: 105
 *                 tempC: 42
 *                 mileageKm: 45000
 *     responses:
 *       200:
 *         description: Tire wear analytics generated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 report:
 *                   $ref: '#/components/schemas/TireAnalyticsReport'
 *       400:
 *         description: Missing or invalid truck_id or tpms_readings.
 *       401:
 *         description: Authentication is required.
 *       429:
 *         description: Rate limit exceeded.
 *       500:
 *         description: Failed to calculate tire wear analytics.
 */

router.post('/analyze', authenticate, userLimiter, async (req, res) => {
  try {
    if (req.user && req.user.role && !ALLOWED_TIRE_ROLES.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access Denied: Only ${ALLOWED_TIRE_ROLES.join(', ')} roles can submit TPMS telemetry`
      });
    }

    const { truck_id, tpms_readings } = req.body;

    if (!truck_id || !Array.isArray(tpms_readings) || tpms_readings.length === 0) {
      return res.status(400).json({ error: 'Missing required parameters: truck_id, tpms_readings (must be non-empty array)' });
    }

    if (!isValidTruckId(truck_id)) {
      return res.status(400).json({ error: 'truck_id must be a valid alphanumeric identifier (1-64 chars)' });
    }

    if (tpms_readings.length > MAX_TIRES_PER_TRUCK) {
      return res.status(400).json({
        error: `Exceeded maximum permissible tire readings of ${MAX_TIRES_PER_TRUCK} per truck telemetry batch`
      });
    }

    for (let i = 0; i < tpms_readings.length; i++) {
      if (!isValidTpmsReading(tpms_readings[i])) {
        return res.status(400).json({
          error: `Invalid TPMS telemetry at index ${i}. Bounds (pressure: 10-200 PSI, temp: -40 to 150 C, mileage: 0-2000000 km)`
        });
      }
    }

    const report = await tireAnalyticsService.analyzeTireHealth({
      ownerId: req.user.id,
      truckId: truck_id.trim(),
      tpmsReadings: tpms_readings
    });

    return res.status(200).json({
      message: 'Tire wear analytics generated successfully',
      report
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to calculate tire wear analytics' });
  }
});

/**
 * GET /api/tire-analytics/status/:truckId
 * Fetches latest tire wear and status report for a truck.
 */
/**
 * @openapi
 * /api/tire-analytics/status/{truckId}:
 *   get:
 *     tags:
 *       - Tire Analytics
 *     summary: Retrieve the latest tire health report
 *     description: Returns the latest tire analytics report for a truck that is visible to the authenticated user.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: truckId
 *         in: path
 *         required: true
 *         description: Truck identifier.
 *         schema:
 *           type: string
 *         example: TRUCK-101
 *     responses:
 *       200:
 *         description: Latest tire analytics report.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 report:
 *                   $ref: '#/components/schemas/TireAnalyticsReport'
 *       401:
 *         description: Authentication is required.
 *       404:
 *         description: No tire analytics report was found.
 *       429:
 *         description: Rate limit exceeded.
 *       500:
 *         description: Failed to retrieve the tire analytics report.
 */

router.get('/status/:truckId', authenticate, userLimiter, async (req, res) => {
  try {
    const { truckId } = req.params;

    if (!isValidTruckId(truckId)) {
      return res.status(400).json({ error: 'Invalid truckId format' });
    }

    const report = await tireAnalyticsService.getTireStatus(
      truckId.trim(),
      req.user.role === 'admin' ? null : req.user.id
    );

    if (!report) {
      return res.status(404).json({ error: 'No tire analytics report found for specified truck' });
    }

    return res.json({ report });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve tire analytics report' });
  }
});

/**
 * POST /api/tire-analytics/reset/:truckId
 * Acknowledges tire maintenance/replacement and resets critical blowout alerts.
 */
router.post('/reset/:truckId', authenticate, userLimiter, async (req, res) => {
  try {
    if (req.user && req.user.role && !ALLOWED_TIRE_ROLES.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access Denied: Only ${ALLOWED_TIRE_ROLES.join(', ')} roles can reset tire alerts`
      });
    }

    const { truckId } = req.params;

    if (!isValidTruckId(truckId)) {
      return res.status(400).json({ error: 'Invalid truckId format' });
    }

    const report = await tireAnalyticsService.getTireStatus(
      truckId.trim(),
      req.user.role === 'admin' ? null : req.user.id
    );

    if (!report) {
      return res.status(404).json({ error: 'No tire analytics report found for specified truck' });
    }

    report.overallHealth = 'OPERATIONAL';
    report.lastMaintenanceResetAt = new Date().toISOString();
    report.maintenanceResetBy = req.user.id;

    return res.json({
      message: 'Tire health alert reset successfully after scheduled maintenance',
      report
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reset tire health alert' });
  }
});

export default router;
