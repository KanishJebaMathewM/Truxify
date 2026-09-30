import { calculateHaversineDistanceMeters } from '../gps/geofenceEvaluator.js';

export class ProfitabilityScorer {
  /**
   * @param {object} [options={}]
   * @param {number} [options.maxDetourRatio=0.15] - Maximum 15% detour allowed
   * @param {number} [options.fuelCostPerKmPaisa=2000] - ₹20.00 / km diesel cost estimate
   */
  constructor(options = {}) {
    this.maxDetourRatio = options.maxDetourRatio || 0.15;
    this.fuelCostPerKmPaisa = options.fuelCostPerKmPaisa || 2000;
  }

  /**
   * Evaluates and scores candidate loads based on detour distance, fuel cost, and net payout.
   * 
   * @param {object} corridor - Corridor details (origin, destination, directDistanceKm)
   * @param {Array<object>} candidateLoads - List of loads found by SpatialMatcher
   * @returns {Array<object>} Ranked list of profitable matches
   */
  scoreAndRankMatches(corridor, candidateLoads = []) {
    const { origin, destination, directDistanceKm } = corridor;
    const directKm = directDistanceKm > 0
      ? directDistanceKm
      : calculateHaversineDistanceMeters(origin.lat, origin.lng, destination.lat, destination.lng) / 1000;

    const scoredMatches = [];

    for (const load of candidateLoads) {
      const pLat = Number(load.pickup_lat);
      const pLng = Number(load.pickup_lng);
      const dLat = Number(load.drop_lat);
      const dLng = Number(load.drop_lng);

      // Approximate segmented distances in km
      const d1 = calculateHaversineDistanceMeters(origin.lat, origin.lng, pLat, pLng) / 1000;
      const d2 = calculateHaversineDistanceMeters(pLat, pLng, dLat, dLng) / 1000;
      const d3 = calculateHaversineDistanceMeters(dLat, dLng, destination.lat, destination.lng) / 1000;

      const totalDetourKm = d1 + d2 + d3;
      const incrementalDetourKm = Math.max(0, totalDetourKm - directKm);
      const detourRatio = directKm > 0 ? incrementalDetourKm / directKm : 0;

      // Filter out loads that exceed 15% detour tolerance
      if (detourRatio > this.maxDetourRatio) {
        continue;
      }

      // Financials in paisa
      const offeredPayoutPaisa = Number(load.price_paisa || 500000); // Default ₹5,000
      const extraFuelPaisa = Math.round(incrementalDetourKm * this.fuelCostPerKmPaisa);
      const extraTollPaisa = Math.round(incrementalDetourKm * 200); // ~₹2/km toll proxy
      const netIncrementalPayoutPaisa = offeredPayoutPaisa - extraFuelPaisa - extraTollPaisa;

      // Skip if net profit is negative
      if (netIncrementalPayoutPaisa <= 0) {
        continue;
      }

      // Affinity Score (0.0 to 1.0)
      const profitMargin = offeredPayoutPaisa > 0 ? netIncrementalPayoutPaisa / offeredPayoutPaisa : 0.5;
      const detourPenalty = 1.0 - (detourRatio / this.maxDetourRatio);
      const affinityScore = Number((0.6 * profitMargin + 0.4 * detourPenalty).toFixed(3));

      scoredMatches.push({
        loadId: load.id,
        customerId: load.customer_id,
        pickupAddress: load.pickup_address,
        dropAddress: load.drop_address,
        weightKg: load.weight_kg,
        financials: {
          offeredPayoutPaisa,
          offeredPayoutInr: Number((offeredPayoutPaisa / 100).toFixed(2)),
          extraFuelInr: Number((extraFuelPaisa / 100).toFixed(2)),
          extraTollInr: Number((extraTollPaisa / 100).toFixed(2)),
          netIncrementalPayoutInr: Number((netIncrementalPayoutPaisa / 100).toFixed(2)),
        },
        detourMetrics: {
          directDistanceKm: Number(directKm.toFixed(1)),
          totalDetourKm: Number(totalDetourKm.toFixed(1)),
          incrementalDetourKm: Number(incrementalDetourKm.toFixed(1)),
          detourPercentage: Number((detourRatio * 100).toFixed(1)),
        },
        affinityScore,
      });
    }

    // Rank descending by highest affinity score
    scoredMatches.sort((a, b) => b.affinityScore - a.affinityScore);

    return scoredMatches;
  }
}

export default ProfitabilityScorer;
