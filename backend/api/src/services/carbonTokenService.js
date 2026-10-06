import logger from '../middleware/logger.js';
import { ValidationError } from '../utils/errors.js';

/**
 * Asserts a telemetry measurement is a real, finite, non-negative number.
 *
 * `Number('abc')` is NaN and `Number('-100')` stays negative; without this guard
 * a NaN fuel-saved figure produced a token whose `co2SavedKg`, `tokenAmount` and
 * `match` values were all NaN, yet it was still minted and could then be sold
 * as a corporate Scope 3 offset.
 */
function assertNonNegativeNumber(value, field) {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new ValidationError(`${field} must be a finite number`);
  }
  if (n < 0) {
    throw new ValidationError(`${field} must not be negative`);
  }
  return n;
}

// Single-trip plausibility thresholds for minted telematics credits.
export const MAX_DISTANCE_KM = 50000;
export const MAX_FUEL_SAVED_LITERS = 10000;
export const MAX_LOAD_WEIGHT_KG = 100000;

/**
 * Service for calculating freight telematics carbon savings and minting cross-chain credit tokens.
 */
class CarbonTokenService {
  constructor() {
    this.tokens = new Map();
  }

  /**
   * Calculates CO2 emissions saved based on telematics & load weight, then mints credit tokens.
   * @param {Object} params
   * @param {string} params.truckId
   * @param {string} params.tripId
   * @param {number} params.distanceKm
   * @param {number} params.fuelSavedLiters
   * @param {number} params.loadWeightKg
   * @returns {Object} Minted carbon token metadata
   */
  async calculateAndMintCarbonCredits({ ownerId, truckId, tripId, distanceKm, fuelSavedLiters, loadWeightKg }) {
    if (!truckId || !tripId || fuelSavedLiters === undefined) {
      throw new ValidationError('Missing required parameters: truckId, tripId, fuelSavedLiters');
    }

    const safeDistanceKm = assertNonNegativeNumber(distanceKm, 'distanceKm');
    const safeFuelSavedLiters = assertNonNegativeNumber(fuelSavedLiters, 'fuelSavedLiters');
    const safeLoadWeightKg = assertNonNegativeNumber(loadWeightKg, 'loadWeightKg');

    if (safeFuelSavedLiters === 0) {
      throw new ValidationError('fuelSavedLiters must be greater than 0 to mint carbon credits');
    }

    // Single-trip sanity thresholds: a single freight trip cannot plausibly
    // exceed these, and minting beyond them would create sellable Scope 3
    // offsets from telemetry spikes or unit mistakes.
    if (safeDistanceKm > MAX_DISTANCE_KM) {
      throw new ValidationError(`distance_km exceeds maximum threshold of ${MAX_DISTANCE_KM} km`);
    }
    if (safeFuelSavedLiters > MAX_FUEL_SAVED_LITERS) {
      throw new ValidationError(`fuel_saved_liters exceeds maximum single-trip threshold of ${MAX_FUEL_SAVED_LITERS} L`);
    }
    if (safeLoadWeightKg > MAX_LOAD_WEIGHT_KG) {
      throw new ValidationError(`load_weight_kg exceeds maximum limit of ${MAX_LOAD_WEIGHT_KG} kg`);
    }

    // Standard diesel emission factor: ~2.68 kg CO2 saved per liter of fuel saved
    const co2SavedKg = Number((safeFuelSavedLiters * 2.68).toFixed(2));
    const co2SavedMetricTons = Number((co2SavedKg / 1000).toFixed(4));

    // Tokenize: 1 Token = 1 Metric Ton CO2 saved
    const tokenAmount = co2SavedMetricTons;
    const tokenId = `CCT-${tripId}-${Date.now()}`;

    const tokenRecord = {
      tokenId,
      ownerId,
      truckId,
      tripId,
      distanceKm: safeDistanceKm,
      fuelSavedLiters: safeFuelSavedLiters,
      loadWeightKg: safeLoadWeightKg,
      co2SavedKg,
      co2SavedMetricTons,
      tokenAmount,
      status: 'PENDING_CHAIN_ANCHOR',
      blockchainTxHash: null,
      chainNetwork: null,
      mintedAt: new Date().toISOString()
    };

    this.tokens.set(tokenId, tokenRecord);
    logger.info(`[CarbonTokenService] Minted ${tokenAmount} carbon tokens (${tokenId}) for truck ${truckId}`);

    return tokenRecord;
  }

  /**
   * Transfers/purchases minted carbon credits to offset Scope 3 corporate emissions.
   */
  async purchaseCarbonCredits({ tokenId, buyerAddress, shipperId, ownerId }) {
    if (!this.tokens.has(tokenId)) {
      throw new ValidationError('Carbon credit token not found');
    }

    const token = this.tokens.get(tokenId);
    if (ownerId && token.ownerId && token.ownerId !== ownerId) {
      throw new Error('You do not have permission to retire this carbon credit');
    }
    if (token.status === 'RETIRED_FOR_OFFSET') {
      throw new ValidationError('Carbon credit token has already been redeemed/retired');
    }

    if (!Number.isFinite(token.tokenAmount) || token.tokenAmount <= 0) {
      throw new ValidationError('Carbon credit token has an invalid token amount and cannot be retired');
    }

    token.status = 'RETIRED_FOR_OFFSET';
    token.buyerAddress = buyerAddress;
    token.shipperId = shipperId;
    token.retiredAt = new Date().toISOString();
    token.transferTxHash = null;

    this.tokens.set(tokenId, token);
    logger.info(`[CarbonTokenService] Carbon token ${tokenId} purchased/retired by shipper ${shipperId}`);

    return token;
  }

  /**
   * Fetches carbon token details by ID
   */
  async getTokenDetails(tokenId, ownerId) {
    const token = this.tokens.get(tokenId);
    if (!token || (ownerId && token.ownerId && token.ownerId !== ownerId)) {
      return null;
    }
    return token;
  }
}

export const carbonTokenService = new CarbonTokenService();
export { assertNonNegativeNumber };
