import { CorridorService } from './corridorService.js';
import { SpatialMatcher } from './spatialMatcher.js';
import { ProfitabilityScorer } from './profitabilityScorer.js';
import logger from '../../middleware/logger.js';

export class DriverDispatchPipeline {
  constructor(options = {}) {
    this.corridorService = new CorridorService(options);
    this.spatialMatcher = new SpatialMatcher(options);
    this.profitabilityScorer = new ProfitabilityScorer(options);
  }

  /**
   * Scans a driver's active route or planned return trip for en-route and deadhead return loads.
   * 
   * @param {object} params
   * @param {string} params.driverId - Driver UUID
   * @param {object} params.origin - { lat, lng } Current location or return start
   * @param {object} params.destination - { lat, lng } Home hub / planned destination
   * @param {object} [params.filters={}] - Capacity and departure filters
   * @returns {Promise<object>} Ranked corridor matches and notification dispatch summary
   */
  async findAndDispatchDeadheadLoads(params) {
    const {
      driverId,
      origin,
      destination,
      filters = {},
    } = params;

    if (!driverId || !origin || !destination) {
      throw new Error('driverId, origin, and destination are required for corridor dispatch');
    }

    logger.info(
      { driverId, origin, destination },
      '[DriverDispatchPipeline] Scanning highway corridor for deadhead return loads'
    );

    // 1. Generate Elastic Corridor Buffer Geometry
    const corridor = await this.corridorService.generateCorridor(origin, destination);

    // 2. Spatial Query against Pending Bookings
    const candidates = await this.spatialMatcher.findCorridorLoads(corridor, filters);

    // 3. Score & Rank by Profitability (<15% detour deviation limit)
    const rankedMatches = this.profitabilityScorer.scoreAndRankMatches(corridor, candidates);

    logger.info(
      { driverId, totalCandidates: candidates.length, qualifiedMatches: rankedMatches.length },
      '[DriverDispatchPipeline] Finished corridor load ranking'
    );

    // 4. Format Dispatch Notification Payload
    let dispatchPayload = null;
    if (rankedMatches.length > 0) {
      const bestMatch = rankedMatches[0];
      dispatchPayload = {
        driverId,
        title: `🚛 High-Affinity Return Load Available (+₹${bestMatch.financials.netIncrementalPayoutInr})`,
        body: `Pickup in route: ${bestMatch.pickupAddress} (${bestMatch.detourMetrics.incrementalDetourKm}km detour, ${bestMatch.detourMetrics.detourPercentage}% dev)`,
        data: {
          loadId: bestMatch.loadId,
          netPayoutInr: bestMatch.financials.netIncrementalPayoutInr,
          incrementalDetourKm: bestMatch.detourMetrics.incrementalDetourKm,
          affinityScore: bestMatch.affinityScore,
        },
      };

      logger.info({ driverId, dispatch: dispatchPayload }, '[DriverDispatchPipeline] Dispatching return-load alert to driver');
    }

    return {
      success: true,
      driverId,
      corridorSummary: {
        directDistanceKm: corridor.directDistanceKm,
        bufferRadiusKm: Number((corridor.bufferMeters / 1000).toFixed(1)),
        boundingBox: corridor.boundingBox,
      },
      matchesCount: rankedMatches.length,
      rankedMatches,
      dispatchPayload,
    };
  }
}

export default DriverDispatchPipeline;
