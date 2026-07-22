import express from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { validateBody } from '../middleware/validate.js';
import { matchDeadheadSchema } from '../validation/requestSchemas.js';
import { matchDeadhead } from '../services/ml.js';
import logger from '../middleware/logger.js';

const router = express.Router();

const deadheadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  '/match/deadhead',
  authenticate,
  deadheadLimiter,
  requirePolicy('load-offer:browse'),
  validateBody(matchDeadheadSchema),
  async (req, res) => {
    try {
      const { driver_destination, truck_specs, arrival_time, available_loads } = req.body;

      const result = await matchDeadhead({
        driverDestination: driver_destination,
        truckSpecs: truck_specs,
        arrivalTime: arrival_time,
        availableLoads: available_loads,
      });

      res.json(result);
    } catch (err) {
      if (err.message?.includes('[ML]')) {
        logger.warn({ err: err.message }, 'ML engine unavailable for deadhead matching');
        return res.status(503).json({ error: 'ML recommendation engine is temporarily unavailable.' });
      }
      logger.error({ err }, 'Deadhead matching failed');
      res.status(500).json({ error: 'Deadhead matching failed.' });
    }
  },
);

export default router;
