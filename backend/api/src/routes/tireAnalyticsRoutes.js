import express from 'express';
import { tireAnalyticsService } from '../services/tireAnalyticsService.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

/**
 * POST /api/tire-analytics/analyze
 * Processes TPMS data to predict tire wear and safety alerts
 */
router.post('/analyze', authenticate, userLimiter, async (req, res) => {
  try {
    const { truck_id, tpms_readings } = req.body;

    if (!truck_id || !tpms_readings) {
      return res.status(400).json({ error: 'Missing required parameters: truck_id, tpms_readings' });
    }

    const report = await tireAnalyticsService.analyzeTireHealth({
      truckId: truck_id,
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
 * Fetches latest tire wear and status report for a truck
 */
router.get('/status/:truckId', authenticate, userLimiter, async (req, res) => {
  try {
    const { truckId } = req.params;
    const report = await tireAnalyticsService.getTireStatus(truckId);

    if (!report) {
      return res.status(404).json({ error: 'No tire analytics report found for specified truck' });
    }

    return res.json({ report });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve tire analytics report' });
  }
});

export default router;
