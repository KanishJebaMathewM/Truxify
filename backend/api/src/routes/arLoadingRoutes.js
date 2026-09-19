import express from 'express';
import { arLoadingOptimizerService } from '../services/arLoadingOptimizerService.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

/**
 * @openapi
 * components:
 *   schemas:
 *     ARLoadingContainer:
 *       type: object
 *       properties:
 *         lengthCm:
 *           type: number
 *           minimum: 0
 *           example: 1615
 *         widthCm:
 *           type: number
 *           minimum: 0
 *           example: 259
 *         heightCm:
 *           type: number
 *           minimum: 0
 *           example: 280
 *         maxPayloadKg:
 *           type: number
 *           minimum: 0
 *           example: 20000
 *     ARLoadingPallet:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: PLT-1
 *         lengthCm:
 *           type: number
 *           minimum: 0
 *           example: 120
 *         widthCm:
 *           type: number
 *           minimum: 0
 *           example: 100
 *         heightCm:
 *           type: number
 *           minimum: 0
 *           example: 150
 *         weightKg:
 *           type: number
 *           minimum: 0
 *           example: 850
 *         fragile:
 *           type: boolean
 *           example: false
 *     ARLoadingPlan:
 *       type: object
 *       properties:
 *         planId:
 *           type: string
 *         ownerId:
 *           type: string
 *         container:
 *           $ref: '#/components/schemas/ARLoadingContainer'
 *         totalWeightKg:
 *           type: number
 *         maxPayloadKg:
 *           type: number
 *         volumeUtilizationPercent:
 *           type: number
 *         payloadCapacityPercent:
 *           type: number
 *         axleDistribution:
 *           type: object
 *           properties:
 *             steerAxleKg:
 *               type: integer
 *             driveAxlesKg:
 *               type: integer
 *             trailerAxlesKg:
 *               type: integer
 *             isDotCompliant:
 *               type: boolean
 *         placementSequence:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               stepNumber:
 *                 type: integer
 *               palletId:
 *                 type: string
 *               weightKg:
 *                 type: number
 *               dimensionsCm:
 *                 type: object
 *                 properties:
 *                   length:
 *                     type: number
 *                   width:
 *                     type: number
 *                   height:
 *                     type: number
 *               position3D:
 *                 type: object
 *                 properties:
 *                   xCm:
 *                     type: number
 *                   yCm:
 *                     type: number
 *                   zCm:
 *                     type: number
 *               arBoundingBox:
 *                 type: object
 *                 properties:
 *                   min:
 *                     type: array
 *                     items:
 *                       type: number
 *                   max:
 *                     type: array
 *                     items:
 *                       type: number
 *         createdAt:
 *           type: string
 *           format: date-time
 */



/**
 * POST /api/ar-loading/optimize
 * Calculates optimal 3D loading order and AR bounding box coordinates
 */
/**
 * @openapi
 * /api/ar-loading/optimize:
 *   post:
 *     tags:
 *       - AR Loading
 *     summary: Generate an optimized AR loading plan
 *     description: Calculates pallet placement, volume utilization, payload utilization, and axle distribution for AR rendering.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - pallets
 *             properties:
 *               container:
 *                 $ref: '#/components/schemas/ARLoadingContainer'
 *               pallets:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   $ref: '#/components/schemas/ARLoadingPallet'
 *           example:
 *             container:
 *               lengthCm: 1615
 *               widthCm: 259
 *               heightCm: 280
 *               maxPayloadKg: 20000
 *             pallets:
 *               - id: PLT-1
 *                 lengthCm: 120
 *                 widthCm: 100
 *                 heightCm: 150
 *                 weightKg: 850
 *                 fragile: false
 *     responses:
 *       201:
 *         description: AR container loading plan generated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 plan:
 *                   $ref: '#/components/schemas/ARLoadingPlan'
 *       400:
 *         description: Missing or invalid pallets or container specifications.
 *       401:
 *         description: Authentication is required.
 *       429:
 *         description: Rate limit exceeded.
 *       500:
 *         description: Failed to optimize the AR container loading plan.
 */

router.post('/optimize', authenticate, userLimiter, async (req, res) => {
  try {
    const { container, pallets } = req.body;

    if (!pallets || !Array.isArray(pallets)) {
      return res.status(400).json({ error: 'Missing or invalid pallets list' });
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
 * Fetches calculated 3D spatial layout for AR rendering
 */
/**
 * @openapi
 * /api/ar-loading/plan/{planId}:
 *   get:
 *     tags:
 *       - AR Loading
 *     summary: Retrieve an AR loading plan
 *     description: Returns the calculated 3D spatial layout for an accessible loading plan.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: planId
 *         in: path
 *         required: true
 *         description: Loading plan identifier.
 *         schema:
 *           type: string
 *         example: AR-PLAN-1710000000000
 *     responses:
 *       200:
 *         description: AR loading plan.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 plan:
 *                   $ref: '#/components/schemas/ARLoadingPlan'
 *       401:
 *         description: Authentication is required.
 *       404:
 *         description: AR loading plan not found.
 *       429:
 *         description: Rate limit exceeded.
 *       500:
 *         description: Failed to retrieve the AR loading plan.
 */

router.get('/plan/:planId', authenticate, userLimiter, async (req, res) => {
  try {
    const { planId } = req.params;
    const plan = await arLoadingOptimizerService.getLoadingPlan(
      planId,
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

export default router;
