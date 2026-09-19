import logger from '../../middleware/logger.js';
import { supabase } from '../../config/db.js';

export class SpatialMatcher {
  constructor(options = {}) {
    this.supabase = options.supabase || supabase;
  }

  /**
   * Scans for pending freight loads within the spatial corridor bounding box.
   * 
   * @param {object} corridor - Output from CorridorService.generateCorridor
   * @param {object} [filters={}] - { maxWeightKg, vehicleType, driverEarliestDeparture }
   * @returns {Promise<Array<object>>} Candidate en-route / deadhead return loads
   */
  async findCorridorLoads(corridor, filters = {}) {
    const { boundingBox } = corridor;
    if (!boundingBox) {
      throw new Error('Corridor bounding box is required for spatial query');
    }

    logger.debug({ boundingBox }, '[SpatialMatcher] Querying pending loads within spatial corridor');

    try {
      if (this.supabase && typeof this.supabase.from === 'function') {
        // Query pending bookings within the bounding box
        let query = this.supabase
          .from('bookings')
          .select('id, customer_id, pickup_address, drop_address, pickup_lat, pickup_lng, drop_lat, drop_lng, weight_kg, price_paisa, pickup_time_window_start, pickup_time_window_end, status')
          .eq('status', 'PENDING')
          .gte('pickup_lng', boundingBox.minLng)
          .lte('pickup_lng', boundingBox.maxLng)
          .gte('pickup_lat', boundingBox.minLat)
          .lte('pickup_lat', boundingBox.maxLat);

        if (filters.maxWeightKg) {
          query = query.lte('weight_kg', filters.maxWeightKg);
        }

        const { data, error } = await query.limit(50);

        if (error) {
          logger.warn({ error: error.message }, '[SpatialMatcher] Database query warning; using empty set');
          return [];
        }

        return data || [];
      }

      return [];
    } catch (err) {
      logger.error({ err }, '[SpatialMatcher] Spatial query exception');
      return [];
    }
  }

  /**
   * Evaluates if a driver's estimated arrival time at the pickup coordinate
   * matches the shipper's operational time window.
   * 
   * @param {Date|string} driverPickupEta
   * @param {Date|string} windowStart
   * @param {Date|string} windowEnd
   * @returns {boolean}
   */
  isTimeWindowFeasible(driverPickupEta, windowStart, windowEnd) {
    if (!windowStart && !windowEnd) return true;

    const etaMs = new Date(driverPickupEta).getTime();
    if (windowStart && etaMs < new Date(windowStart).getTime()) {
      return false;
    }
    if (windowEnd && etaMs > new Date(windowEnd).getTime()) {
      return false;
    }
    return true;
  }
}

export default SpatialMatcher;
