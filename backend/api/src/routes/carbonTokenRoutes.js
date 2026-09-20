import express from 'express';
import { carbonTokenService } from '../services/carbonTokenService.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const TOKEN_ID_REGEX = /^CCT-[A-Za-z0-9_\-:]+-\d+$/;
const IDENTIFIER_REGEX = /^[A-Za-z0-9_\-:.]{1,64}$/;

export const MAX_DISTANCE_KM = 50000;
export const MAX_FUEL_SAVED_LITERS = 10000;
export const MAX_LOAD_WEIGHT_KG = 100000;

export const ALLOWED_MINT_ROLES = Object.freeze(['carrier', 'driver', 'fleet_owner', 'admin']);
export const ALLOWED_PURCHASE_ROLES = Object.freeze(['shipper', 'broker', 'admin']);

/**
 * Validates 40-character hex EVM buyer address format.
 */
export const isValidEvmAddress = (address) => {
  return typeof address === 'string' && EVM_ADDRESS_REGEX.test(address.trim());
};

/**
 * Validates carbon token identifier format.
 */
export const isValidTokenId = (tokenId) => {
  return typeof tokenId === 'string' && (TOKEN_ID_REGEX.test(tokenId.trim()) || IDENTIFIER_REGEX.test(tokenId.trim()));
};

/**
 * Validates general truck/trip entity identifiers.
 */
export const isValidIdentifier = (id) => {
  return typeof id === 'string' && IDENTIFIER_REGEX.test(id.trim());
};

/**
 * POST /api/carbon-credits/mint
 * Calculates carbon savings from telematics & mints cross-chain carbon tokens.
 * Restricted to carriers, drivers, fleet owners, and admins.
 */
router.post('/mint', authenticate, userLimiter, async (req, res) => {
  try {
    if (req.user && req.user.role && !ALLOWED_MINT_ROLES.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access Denied: Only ${ALLOWED_MINT_ROLES.join(', ')} roles can mint carbon credit tokens`
      });
    }

    const { truck_id, trip_id, distance_km, fuel_saved_liters, load_weight_kg } = req.body;

    if (!truck_id || !trip_id || fuel_saved_liters === undefined) {
      return res.status(400).json({ error: 'Missing required parameters: truck_id, trip_id, fuel_saved_liters' });
    }

    if (!isValidIdentifier(truck_id) || !isValidIdentifier(trip_id)) {
      return res.status(400).json({ error: 'truck_id and trip_id must be valid alphanumeric identifiers (1-64 chars)' });
    }

    const distanceKm = Number(distance_km ?? 0);
    const fuelSavedLiters = Number(fuel_saved_liters);
    const loadWeightKg = Number(load_weight_kg ?? 0);

    if (![distanceKm, fuelSavedLiters, loadWeightKg].every(Number.isFinite) ||
        distanceKm < 0 || loadWeightKg < 0) {
      return res.status(400).json({ error: 'Carbon metrics must be finite, non-negative numbers' });
    }

    if (fuelSavedLiters <= 0) {
      return res.status(400).json({ error: 'fuel_saved_liters must be a positive finite number greater than zero' });
    }

    if (distanceKm > MAX_DISTANCE_KM) {
      return res.status(400).json({ error: `distance_km exceeds maximum threshold of ${MAX_DISTANCE_KM} km` });
    }

    if (fuelSavedLiters > MAX_FUEL_SAVED_LITERS) {
      return res.status(400).json({ error: `fuel_saved_liters exceeds maximum single-trip threshold of ${MAX_FUEL_SAVED_LITERS} L` });
    }

    if (loadWeightKg > MAX_LOAD_WEIGHT_KG) {
      return res.status(400).json({ error: `load_weight_kg exceeds maximum limit of ${MAX_LOAD_WEIGHT_KG} kg` });
    }

    const token = await carbonTokenService.calculateAndMintCarbonCredits({
      ownerId: req.user.id,
      truckId: truck_id.trim(),
      tripId: trip_id.trim(),
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
 * POST /api/carbon-credits/purchase
 * Enables corporate shippers to buy and retire tokens for Scope 3 offsets.
 * Restricted to shippers, brokers, and admins.
 */
router.post('/purchase', authenticate, userLimiter, async (req, res) => {
  try {
    if (req.user && req.user.role && !ALLOWED_PURCHASE_ROLES.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access Denied: Only ${ALLOWED_PURCHASE_ROLES.join(', ')} roles can purchase and retire carbon credits`
      });
    }

    const { token_id, buyer_address } = req.body;

    if (!token_id || !buyer_address) {
      return res.status(400).json({ error: 'Missing required parameters: token_id, buyer_address' });
    }

    if (!isValidTokenId(token_id)) {
      return res.status(400).json({ error: 'token_id is not a valid carbon credit token format' });
    }

    if (!isValidEvmAddress(buyer_address)) {
      return res.status(400).json({ error: 'buyer_address must be a valid 40-character hex EVM wallet address' });
    }

    const redeemedToken = await carbonTokenService.purchaseCarbonCredits({
      tokenId: token_id.trim(),
      buyerAddress: buyer_address.trim(),
      shipperId: req.user.id,
      ownerId: req.user.id,
    });

    return res.json({
      message: 'Carbon credits successfully purchased and retired for Scope 3 emissions offset',
      token: redeemedToken
    });
  } catch (err) {
    const status = err.message?.toLowerCase().includes('not found') ? 404 : 500;
    return res.status(status).json({ error: err.message || 'Failed to purchase carbon credit tokens' });
  }
});

/**
 * GET /api/carbon-credits/:tokenId
 * Fetches token details and chain verification state.
 */
router.get('/:tokenId', authenticate, userLimiter, async (req, res) => {
  try {
    const { tokenId } = req.params;

    if (!isValidTokenId(tokenId)) {
      return res.status(400).json({ error: 'Invalid tokenId format' });
    }

    const token = await carbonTokenService.getTokenDetails(
      tokenId.trim(),
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
