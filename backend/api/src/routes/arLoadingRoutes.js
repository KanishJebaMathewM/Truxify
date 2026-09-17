import express from 'express';
import { arLoadingOptimizerService } from '../services/arLoadingOptimizerService.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

/**
 * POST /api/ar-loading/optimize
 * Calculates optimal 3D loading order and AR bounding box coordinates
 */
router.post('/optimize', authenticate, userLimiter, async (req, res) => {
  try {
    const { container, pallets } = req.body;

    if (!pallets || !Array.isArray(pallets)) {
      return res.status(400).json({ error: 'Missing or invalid pallets list' });
    }

    const plan = await arLoadingOptimizerService.generateLoadingPlan({
      container: container || {},
      pallets
    });

    return res.status(201).json({
      message: 'AR container loading plan generated successfully',
      plan
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to optimize AR container loading plan' });
  }
});

/**
 * GET /api/ar-loading/plan/:planId
 * Fetches calculated 3D spatial layout for AR rendering
 */
router.get('/plan/:planId', authenticate, userLimiter, async (req, res) => {
  try {
    const { planId } = req.params;
    const plan = await arLoadingOptimizerService.getLoadingPlan(planId);

    if (!plan) {
      return res.status(404).json({ error: 'AR loading plan not found' });
    }

    return res.json({ plan });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve AR loading plan' });
  }
});

export default router;
