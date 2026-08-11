import express from 'express';
import { createUserClient } from '../src/config/db.js';
import { authenticate } from '../src/middleware/auth.js';
import { userLimiter } from '../src/middleware/rateLimiter.js';
import { requirePolicy } from '../src/middleware/requirePolicy.js';
import { validateQuery } from '../src/middleware/validate.js';
import { earningsSummarySchema } from '../src/validation/requestSchemas.js';
import logger from '../src/middleware/logger.js';
import {
  MAX_TRIPS_PER_SUMMARY,
  buildEarningsSummary,
  getPeriodStart,
} from '../src/services/driver/earningsSummaryService.js';

const router = express.Router();

/**
 * @openapi
 * /api/earnings/summary:
 *   get:
 *     tags: [Driver]
 *     summary: Driver earnings summary
 *     description: >
 *       Aggregated gross, deductions and net earnings for the authenticated
 *       driver over the requested reporting period, with a per-trip breakdown.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [weekly, monthly]
 *           default: monthly
 *     responses:
 *       200:
 *         description: Earnings summary for the authenticated driver
 *       400:
 *         description: Invalid period
 *       401:
 *         description: Missing or invalid authentication token
 *       403:
 *         description: Caller is not a driver
 *       500:
 *         description: Internal Server Error
 */
router.get(
  '/summary',
  authenticate,
  userLimiter,
  requirePolicy('driver:view-earnings'),
  validateQuery(earningsSummarySchema),
  async (req, res) => {
    const period = req.query.period || 'monthly';
    const driverId = req.user.id;

    try {
      const periodStart = getPeriodStart(period);

      // Query trips through the caller's user-scoped client so the trips RLS
      // policy (driver_id = get_profile_id()) sees the authenticated driver's
      // identity. The shared anon client has no identity and can never return
      // the driver's rows.
      const userClient = createUserClient(req.token);
      const { data: trips, error } = await userClient
        .from('trips')
        .select('trip_display_id, trip_date, distance, total_earnings, fuel_deducted')
        .eq('driver_id', driverId)
        .eq('status', 'completed')
        .gte('trip_date', periodStart.toISOString().split('T')[0])
        .order('trip_date', { ascending: false })
        .limit(MAX_TRIPS_PER_SUMMARY);

      if (error) {
        logger.error(
          { err: error, driverId, period },
          '[earnings] Failed to fetch trips for summary'
        );
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch earnings summary.',
        });
      }

      return res.json({
        success: true,
        data: buildEarningsSummary(trips, period, driverId),
      });
    } catch (err) {
      logger.error({ err, driverId, period }, '[earnings] Earnings summary error');
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

export default router;
