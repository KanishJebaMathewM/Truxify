import express from 'express';
import { z } from 'zod';
import { optimizeTollRoutes } from '../services/tollOptimization.js';
import { validateBody } from '../middleware/validate.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import logger from '../middleware/logger.js';

const router = express.Router();

const candidateRouteSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(200).optional(),
  baseTollUSD: z.number().nonnegative().optional(),
  distanceMiles: z.number().positive(),
  estimatedTimeHours: z.number().positive(),
});

const loadDetailsSchema = z.object({
  grossPayoutUSD: z.number().nonnegative().optional(),
  axleCount: z.number().int().nonnegative().optional(),
  fuelPrice: z.number().positive().optional(),
  mpg: z.number().positive().optional(),
  driverHourlyRate: z.number().positive().optional(),
});

const tollOptimizeSchema = z.object({
  routes: z.array(candidateRouteSchema).min(1, 'Array of candidate routes is required.'),
  loadDetails: loadDetailsSchema.optional(),
}).strict();

router.post('/optimize', userLimiter, validateBody(tollOptimizeSchema), (req, res) => {
  try {
    const result = optimizeTollRoutes(req.body.routes, req.body.loadDetails);
    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error({ err: error }, 'Toll optimization failed');
    return res.status(500).json({ error: 'Failed to optimize routes.' });
  }
});

export default router;