import logger from '../../middleware/logger.js';
import { CANDIDATE_FIELDS, MAX_CANDIDATES, ownedBounds, ownedFilters, admitRows, timeWindowFeasible } from './spatialObservation.js';

export class SpatialQueryUnavailable extends Error {
  constructor(status, cause) {
    super('Spatial booking query is unobserved', { cause });
    this.name = 'SpatialQueryUnavailable'; this.code = 'SPATIAL_QUERY_UNOBSERVED'; this.status = status;
  }
}
export class SpatialMatcher {
  #client;
  #timeout;
  constructor(options = {}) {
    this.#client = options.supabase ?? null;
    if (this.#client !== null && typeof this.#client.from !== 'function') throw new TypeError('Supabase client must expose from()');
    this.#timeout = options.queryTimeoutMs ?? 10000;
    if (!Number.isSafeInteger(this.#timeout) || this.#timeout < 1 || this.#timeout > 60000) throw new RangeError('query timeout must be an integer in [1,60000]');
  }
  get supabase() { return this.#client; }
  async findCorridorLoads(corridor, filters = {}) {
    const box = ownedBounds(corridor?.boundingBox);
    const policy = ownedFilters(filters);
    const signal = AbortSignal.timeout(this.#timeout);
    let status = 0;
    try {
      if (!this.#client) this.#client = (await import('../../config/db.js')).supabase;
      if (!this.#client || typeof this.#client.from !== 'function') throw new Error('Supabase client unavailable');
      let query = this.#client.from('bookings').select(CANDIDATE_FIELDS.join(',')).eq('status', 'PENDING')
        .gte('pickup_lng', box.minLng).lte('pickup_lng', box.maxLng).gte('pickup_lat', box.minLat).lte('pickup_lat', box.maxLat);
      if (policy.weight !== undefined) query = query.lte('weight_kg', policy.weight);
      if (policy.departure !== undefined) {
        query = query.or(`pickup_time_window_end.is.null,pickup_time_window_end.gte.${new Date(policy.departure).toISOString()}`);
      }
      const response = await query.limit(MAX_CANDIDATES).retry(false).abortSignal(signal);
      status = response?.status ?? 0;
      if (response?.error !== null || ![200, 206].includes(status)) throw response?.error ?? new Error('query response is not observed');
      return admitRows(response.data, box, policy);
    } catch (cause) {
      logger.warn({ status }, '[SpatialMatcher] Query unobserved; no successful empty scan inferred');
      throw new SpatialQueryUnavailable(status, cause);
    }
  }
  isTimeWindowFeasible(driverPickupEta, windowStart, windowEnd) {
    return timeWindowFeasible(driverPickupEta, windowStart, windowEnd);
  }
}
export default SpatialMatcher;
