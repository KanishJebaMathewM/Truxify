import express from 'express';
import { carbonTokenService } from '../services/carbonTokenService.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

/**
 * POST /api/carbon-credits/mint
 * Calculates carbon savings from telematics & mints cross-chain carbon tokens
 */
router.post('/mint', authenticate, userLimiter, async (req, res) => {
  try {
    const { truck_id, trip_id, distance_km, fuel_saved_liters, load_weight_kg } = req.body;

    if (!truck_id || !trip_id || fuel_saved_liters === undefined) {
      return res.status(400).json({ error: 'Missing required parameters: truck_id, trip_id, fuel_saved_liters' });
    }

    const token = await carbonTokenService.calculateAndMintCarbonCredits({
      truckId: truck_id,
      tripId: trip_id,
      distanceKm: Number(distance_km || 0),
      fuelSavedLiters: Number(fuel_saved_liters),
      loadWeightKg: Number(load_weight_kg || 0)
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
 * POST /api/carbon-credits/purchase
 * Enables corporate shippers to buy and retire tokens for Scope 3 offsets
 */
router.post('/purchase', authenticate, userLimiter, async (req, res) => {
  try {
    const { token_id, buyer_address, shipper_id } = req.body;

    if (!token_id || !buyer_address || !shipper_id) {
      return res.status(400).json({ error: 'Missing required parameters: token_id, buyer_address, shipper_id' });
    }

    const redeemedToken = await carbonTokenService.purchaseCarbonCredits({
      tokenId: token_id,
      buyerAddress: buyer_address,
      shipperId: shipper_id
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
 * GET /api/carbon-credits/:tokenId
 * Fetches token details and chain verification state
 */
router.get('/:tokenId', authenticate, userLimiter, async (req, res) => {
  try {
    const { tokenId } = req.params;
    const token = await carbonTokenService.getTokenDetails(tokenId);

    if (!token) {
      return res.status(404).json({ error: 'Carbon credit token not found' });
    }

    return res.json({ token });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve carbon token details' });
  }
});

export default router;
