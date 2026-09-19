import express from 'express';
import { carbonTokenService } from '../services/carbonTokenService.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

/**
 * @openapi
 * /api/carbon-credits/mint:
 *   post:
 *     tags: [Carbon Credits]
 *     summary: Mint carbon credits from freight emissions savings
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [truck_id, trip_id, fuel_saved_liters]
 *             properties:
 *               truck_id:
 *                 type: string
 *               trip_id:
 *                 type: string
 *               distance_km:
 *                 type: number
 *               fuel_saved_liters:
 *                 type: number
 *               load_weight_kg:
 *                 type: number
 *     responses:
 *       201:
 *         description: Carbon credits calculated and minted successfully
 *       400:
 *         description: Missing or invalid carbon metric input
 *       401:
 *         description: Missing or invalid authentication token
 *       500:
 *         description: Carbon credit minting failed
 */
router.post('/mint', authenticate, userLimiter, async (req, res) => {
  try {
    const { truck_id, trip_id, distance_km, fuel_saved_liters, load_weight_kg } = req.body;

    if (!truck_id || !trip_id || fuel_saved_liters === undefined) {
      return res.status(400).json({ error: 'Missing required parameters: truck_id, trip_id, fuel_saved_liters' });
    }

    const distanceKm = Number(distance_km ?? 0);
    const fuelSavedLiters = Number(fuel_saved_liters);
    const loadWeightKg = Number(load_weight_kg ?? 0);
    if (![distanceKm, fuelSavedLiters, loadWeightKg].every(Number.isFinite) ||
        [distanceKm, fuelSavedLiters, loadWeightKg].some((value) => value < 0)) {
      return res.status(400).json({ error: 'Carbon metrics must be finite, non-negative numbers' });
    }

    const token = await carbonTokenService.calculateAndMintCarbonCredits({
      ownerId: req.user.id,
      truckId: truck_id,
      tripId: trip_id,
      distanceKm,
      fuelSavedLiters,
      loadWeightKg
    });

    return res.status(201).json({
      message: 'Freight carbon credits calculated and minted successfully',
      token
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to mint carbon credit tokens' });
  }
});

/**
 * @openapi
 * /api/carbon-credits/purchase:
 *   post:
 *     tags: [Carbon Credits]
 *     summary: Purchase and retire carbon credits
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token_id, buyer_address]
 *             properties:
 *               token_id:
 *                 type: string
 *               buyer_address:
 *                 type: string
 *     responses:
 *       200:
 *         description: Carbon credits purchased and retired successfully
 *       400:
 *         description: Missing required parameters
 *       401:
 *         description: Missing or invalid authentication token
 *       500:
 *         description: Carbon credit purchase failed
 */
router.post('/purchase', authenticate, userLimiter, async (req, res) => {
  try {
    const { token_id, buyer_address } = req.body;

    if (!token_id || !buyer_address) {
      return res.status(400).json({ error: 'Missing required parameters: token_id, buyer_address' });
    }

    const redeemedToken = await carbonTokenService.purchaseCarbonCredits({
      tokenId: token_id,
      buyerAddress: buyer_address,
      shipperId: req.user.id,
      ownerId: req.user.id,
    });

    return res.json({
      message: 'Carbon credits successfully purchased and retired for Scope 3 emissions offset',
      token: redeemedToken
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to purchase carbon credit tokens' });
  }
});

/**
 * @openapi
 * /api/carbon-credits/{tokenId}:
 *   get:
 *     tags: [Carbon Credits]
 *     summary: Get carbon credit token details
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tokenId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Carbon credit token details and chain verification state
 *       401:
 *         description: Missing or invalid authentication token
 *       404:
 *         description: Carbon credit token not found
 *       500:
 *         description: Carbon credit lookup failed
 */
router.get('/:tokenId', authenticate, userLimiter, async (req, res) => {
  try {
    const { tokenId } = req.params;
    const token = await carbonTokenService.getTokenDetails(
      tokenId,
      req.user.role === 'admin' ? null : req.user.id
    );

    if (!token) {
      return res.status(404).json({ error: 'Carbon credit token not found' });
    }

    return res.json({ token });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve carbon token details' });
  }
});

export default router;
