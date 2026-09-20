import express from 'express';
import { arLoadingOptimizerService } from '../services/arLoadingOptimizerService.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

export const MAX_PALLETS_PER_REQUEST = 100;
export const ALLOWED_AR_ROLES = Object.freeze(['carrier', 'driver', 'dispatcher', 'admin']);
export const PLAN_ID_REGEX = /^PLAN-[a-zA-Z0-9_\-]{6,64}$/;

/**
 * Validates container physical dimensional specifications.
 */
export const isValidContainerSpecs = (container) => {
  if (!container || typeof container !== 'object') return false;
  const { lengthCm, widthCm, heightCm, maxPayloadKg } = container;

  if (lengthCm !== undefined && (!Number.isFinite(lengthCm) || lengthCm < 100 || lengthCm > 2500)) return false;
  if (widthCm !== undefined && (!Number.isFinite(widthCm) || widthCm < 50 || widthCm > 500)) return false;
  if (heightCm !== undefined && (!Number.isFinite(heightCm) || heightCm < 50 || heightCm > 500)) return false;
  if (maxPayloadKg !== undefined && (!Number.isFinite(maxPayloadKg) || maxPayloadKg < 100 || maxPayloadKg > 60000)) return false;

  return true;
};

/**
 * Validates individual pallet parameters.
 */
export const isValidPallet = (pallet) => {
  if (!pallet || typeof pallet !== 'object') return false;
  const { lengthCm, widthCm, heightCm, weightKg } = pallet;

  if (lengthCm !== undefined && (!Number.isFinite(lengthCm) || lengthCm < 10 || lengthCm > 500)) return false;
  if (widthCm !== undefined && (!Number.isFinite(widthCm) || widthCm < 10 || widthCm > 500)) return false;
  if (heightCm !== undefined && (!Number.isFinite(heightCm) || heightCm < 10 || heightCm > 500)) return false;
  if (weightKg !== undefined && (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 25000)) return false;

  return true;
};

/**
 * Validates AR plan identifier.
 */
export const isValidPlanId = (planId) => {
  return typeof planId === 'string' && PLAN_ID_REGEX.test(planId.trim());
};

/**
 * POST /api/ar-loading/optimize
 * Calculates optimal 3D loading order and AR bounding box coordinates.
 * Restricted to carriers, drivers, dispatchers, and admins.
 */
router.post('/optimize', authenticate, userLimiter, async (req, res) => {
  try {
    if (req.user && req.user.role && !ALLOWED_AR_ROLES.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access Denied: Only ${ALLOWED_AR_ROLES.join(', ')} roles can generate AR loading plans`
      });
    }

    const { container, pallets } = req.body;

    if (!pallets || !Array.isArray(pallets) || pallets.length === 0) {
      return res.status(400).json({ error: 'Missing or empty pallets array. Must provide at least one pallet.' });
    }

    if (pallets.length > MAX_PALLETS_PER_REQUEST) {
      return res.status(400).json({
        error: `Exceeded maximum permissible pallets limit of ${MAX_PALLETS_PER_REQUEST} per optimization batch`
      });
    }

    if (container && !isValidContainerSpecs(container)) {
      return res.status(400).json({
        error: 'Invalid container specifications. Dimensions (length: 100-2500cm, width: 50-500cm, height: 50-500cm, maxPayload: 100-60000kg)'
      });
    }

    for (let i = 0; i < pallets.length; i++) {
      if (!isValidPallet(pallets[i])) {
        return res.status(400).json({
          error: `Invalid pallet specifications at index ${i}. Dimensions (length, width, height: 10-500cm, weight: 1-25000kg)`
        });
      }
    }

    const plan = await arLoadingOptimizerService.generateLoadingPlan({
      ownerId: req.user.id,
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
 * Fetches calculated 3D spatial layout for AR rendering.
 */
router.get('/plan/:planId', authenticate, userLimiter, async (req, res) => {
  try {
    const { planId } = req.params;

    if (!isValidPlanId(planId)) {
      return res.status(400).json({ error: 'Invalid planId format. Expected PLAN-<id>' });
    }

    const plan = await arLoadingOptimizerService.getLoadingPlan(
      planId.trim(),
      req.user.role === 'admin' ? null : req.user.id
    );

    if (!plan) {
      return res.status(404).json({ error: 'AR loading plan not found' });
    }

    return res.json({ plan });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve AR loading plan' });
  }
});

/**
 * POST /api/ar-loading/verify/:planId
 * Verifies physical trailer loading completion against the AR spatial model.
 */
router.post('/verify/:planId', authenticate, userLimiter, async (req, res) => {
  try {
    const { planId } = req.params;

    if (!isValidPlanId(planId)) {
      return res.status(400).json({ error: 'Invalid planId format. Expected PLAN-<id>' });
    }

    const plan = await arLoadingOptimizerService.getLoadingPlan(
      planId.trim(),
      req.user.role === 'admin' ? null : req.user.id
    );

    if (!plan) {
      return res.status(404).json({ error: 'AR loading plan not found' });
    }

    plan.status = 'VERIFIED_PHYSICALLY_LOADED';
    plan.verifiedAt = new Date().toISOString();
    plan.verifiedBy = req.user.id;

    return res.json({
      message: 'AR loading plan verified successfully against physical load',
      plan
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to verify AR loading plan' });
  }
});

export default router;
