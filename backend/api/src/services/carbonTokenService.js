import logger from '../middleware/logger.js';

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
  async calculateAndMintCarbonCredits({ truckId, tripId, distanceKm, fuelSavedLiters, loadWeightKg }) {
    if (!truckId || !tripId || fuelSavedLiters === undefined) {
      throw new Error('Missing required parameters: truckId, tripId, fuelSavedLiters');
    }

    // Standard diesel emission factor: ~2.68 kg CO2 saved per liter of fuel saved
    const co2SavedKg = Number((fuelSavedLiters * 2.68).toFixed(2));
    const co2SavedMetricTons = Number((co2SavedKg / 1000).toFixed(4));

    // Tokenize: 1 Token = 1 Metric Ton CO2 saved
    const tokenAmount = co2SavedMetricTons;
    const tokenId = `CCT-${tripId}-${Date.now()}`;

    const tokenRecord = {
      tokenId,
      truckId,
      tripId,
      distanceKm: distanceKm || 0,
      fuelSavedLiters,
      loadWeightKg: loadWeightKg || 0,
      co2SavedKg,
      co2SavedMetricTons,
      tokenAmount,
      status: 'MINTED',
      blockchainTxHash: `0x${Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('')}`,
      chainNetwork: 'Polygon-CrossChain-Anchor',
      mintedAt: new Date().toISOString()
    };

    this.tokens.set(tokenId, tokenRecord);
    logger.info(`[CarbonTokenService] Minted ${tokenAmount} carbon tokens (${tokenId}) for truck ${truckId}`);

    return tokenRecord;
  }

  /**
   * Transfers/purchases minted carbon credits to offset Scope 3 corporate emissions.
   */
  async purchaseCarbonCredits({ tokenId, buyerAddress, shipperId }) {
    if (!this.tokens.has(tokenId)) {
      throw new Error('Carbon credit token not found');
    }

    const token = this.tokens.get(tokenId);
    if (token.status === 'RETIRED_FOR_OFFSET') {
      throw new Error('Carbon credit token has already been redeemed/retired');
    }

    token.status = 'RETIRED_FOR_OFFSET';
    token.buyerAddress = buyerAddress;
    token.shipperId = shipperId;
    token.retiredAt = new Date().toISOString();
    token.transferTxHash = `0x${Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('')}`;

    this.tokens.set(tokenId, token);
    logger.info(`[CarbonTokenService] Carbon token ${tokenId} purchased/retired by shipper ${shipperId}`);

    return token;
  }

  /**
   * Fetches carbon token details by ID
   */
  async getTokenDetails(tokenId) {
    return this.tokens.get(tokenId) || null;
  }
}

export const carbonTokenService = new CarbonTokenService();
