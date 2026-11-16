import { calculateHaversineDistanceMeters } from '../gps/geofenceEvaluator.js';
import { paisa, finiteNumber, geographic, admitCandidates, roundDistanceChargePaisa, detourPolicy, affinity, compareAffinity, presentedAffinity } from './profitabilityPolicy.js';

export class ProfitabilityScorer {
  #ratio;
  #fuelRate;
  constructor(options = {}) {
    this.#ratio = finiteNumber(options.maxDetourRatio ?? 0.15, 'detour ratio');
    if (this.#ratio < 0 || this.#ratio > 1) throw new RangeError('detour ratio must be in [0,1]');
    this.#fuelRate = paisa(options.fuelCostPerKmPaisa ?? 2000, 'fuel rate');
  }
  get maxDetourRatio() { return this.#ratio; }
  get fuelCostPerKmPaisa() { return Number(this.#fuelRate); }

  /** Admit complete owned inputs; publish only finite ranked records with exact integer paisa charges. */
  scoreAndRankMatches(corridor, candidateLoads = []) {
    if (!corridor || typeof corridor !== 'object' || Array.isArray(corridor)) throw new TypeError('corridor must be an object');
    const origin = geographic(corridor.origin, 'origin');
    const destination = geographic(corridor.destination, 'destination');
    const supplied = finiteNumber(corridor.directDistanceKm ?? 0, 'direct distance');
    if (supplied < 0) throw new RangeError('direct distance must be nonnegative');
    const loads = admitCandidates(candidateLoads);
    const directKm = supplied || calculateHaversineDistanceMeters(origin.lat, origin.lng, destination.lat, destination.lng) / 1000;
    finiteNumber(directKm, 'computed direct distance');
    const scored = [];
    for (const load of loads) {
      if (load.payout === 0n) continue;
      const d1 = calculateHaversineDistanceMeters(origin.lat, origin.lng, load.pickup.lat, load.pickup.lng) / 1000;
      const d2 = calculateHaversineDistanceMeters(load.pickup.lat, load.pickup.lng, load.drop.lat, load.drop.lng) / 1000;
      const d3 = calculateHaversineDistanceMeters(load.drop.lat, load.drop.lng, destination.lat, destination.lng) / 1000;
      const total = finiteNumber(d1 + d2 + d3, 'computed segmented distance');
      const incremental = Math.max(0, total - directKm);
      const penalty = detourPolicy(incremental, directKm, this.#ratio);
      if (!penalty) continue;
      const fuel = roundDistanceChargePaisa(incremental, this.#fuelRate);
      const toll = roundDistanceChargePaisa(incremental, 200n);
      const net = load.payout - fuel - toll;
      if (net <= 0n) continue;
      // Positive net guarantees every published fee/net is within admitted safe payout.
      const score = affinity(net, load.payout, penalty);
      const detourRatio = directKm ? incremental / directKm : 0;
      const inr = value => Number((Number(value) / 100).toFixed(2));
      scored.push({ score, index: load.index, output: {
        loadId: load.id, customerId: load.customer, pickupAddress: load.pickupAddress, dropAddress: load.dropAddress, weightKg: load.weight,
        financials: { offeredPayoutPaisa: Number(load.payout), offeredPayoutInr: inr(load.payout),
          extraFuelPaisa: Number(fuel), extraTollPaisa: Number(toll), netIncrementalPayoutPaisa: Number(net),
          extraFuelInr: inr(fuel), extraTollInr: inr(toll), netIncrementalPayoutInr: inr(net) },
        detourMetrics: { directDistanceKm: Number(directKm.toFixed(1)), totalDetourKm: Number(total.toFixed(1)),
          incrementalDetourKm: Number(incremental.toFixed(1)), detourPercentage: Number((detourRatio * 100).toFixed(1)) },
        affinityScore: presentedAffinity(score),
      } });
    }
    scored.sort((left, right) => compareAffinity(right.score, left.score) || left.index - right.index);
    return scored.map(item => item.output);
  }
}
export default ProfitabilityScorer;
