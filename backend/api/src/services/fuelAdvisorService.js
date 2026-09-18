import { DomainError } from './order/domainError.js';

/**
 * Calculates fuel efficiency (e.g. km/L) from distance and fuel consumed.
 * Guards against division by zero, null/undefined inputs, and NaN results.
 *
 * @param {number} distance - Distance traveled
 * @param {number} fuelAmount - Fuel consumed
 * @param {Object|number} [options] - Safe fallback value or options object ({ fallback, throwOnError })
 * @returns {number} Safe fuel efficiency value
 */
export function calculateFuelEfficiency(distance, fuelAmount, options = {}) {
  const fallback = typeof options === 'number' ? options : (options?.fallback ?? 0);
  const throwOnError = typeof options === 'object' && options?.throwOnError === true;

  const numDistance = Number(distance);
  const numFuel = Number(fuelAmount);

  if (
    distance == null ||
    fuelAmount == null ||
    Number.isNaN(numDistance) ||
    Number.isNaN(numFuel) ||
    !Number.isFinite(numDistance) ||
    !Number.isFinite(numFuel) ||
    numFuel <= 0 ||
    numDistance < 0
  ) {
    if (throwOnError) {
      throw new DomainError(400, { error: 'Invalid distance or fuel amount for fuel efficiency calculation' });
    }
    return fallback;
  }

  const efficiency = numDistance / numFuel;

  if (Number.isNaN(efficiency) || !Number.isFinite(efficiency)) {
    if (throwOnError) {
      throw new DomainError(400, { error: 'Fuel efficiency calculation resulted in NaN' });
    }
    return fallback;
  }

  return efficiency;
}

export class FuelAdvisorService {
  constructor({ supabase, weatherService, logger, fuelPrices = {}, fuelEfficiency = {} }) {
    this.supabase = supabase;
    this.weatherService = weatherService;
    this.logger = logger;
    this.fuelPrices = fuelPrices;
    this.fuelEfficiency = {
      truck: 3.5,
      van: 8,
      car: 12,
      ...fuelEfficiency,
    };
  }

  /**
   * Estimate fuel consumption and cost for one trip leg.
   *
   * @param {number} distanceKm distance in kilometres
   * @param {string} vehicleType vehicle efficiency key
   * @param {number} fuelPricePerLitre current fuel price override
   * @returns {object} estimate result or a validation error
   */
  tripFuelEstimate(distanceKm, vehicleType, fuelPricePerLitre) {
    const distance = Number(distanceKm);
    const type = String(vehicleType || '').toLowerCase();
    const efficiency = Number(this.fuelEfficiency[type]);
    const configuredPrice = fuelPricePerLitre ?? this.fuelPrices[type] ?? this.fuelPrices.default;
    const fuelPrice = Number(configuredPrice);

    if (distanceKm == null || !Number.isFinite(distance) || distance < 0) {
      this.logger?.debug('[FuelAdvisorService] Invalid trip distance supplied');
      return { success: false, error: 'distanceKm must be a non-negative finite number' };
    }

    if (!Number.isFinite(efficiency) || efficiency <= 0) {
      this.logger?.debug(`[FuelAdvisorService] Unsupported vehicle type: ${vehicleType}`);
      return { success: false, error: `Unsupported vehicle type: ${vehicleType}` };
    }

    if (!Number.isFinite(fuelPrice) || fuelPrice < 0) {
      this.logger?.debug('[FuelAdvisorService] Fuel price is unavailable');
      return { success: false, error: 'fuelPricePerLitre must be a finite non-negative number' };
    }

    const fuelUsedLitres = distance / efficiency;
    const fuelCost = fuelUsedLitres * fuelPrice;
    const result = {
      success: true,
      distanceKm: distance,
      vehicleType: type,
      fuelEfficiencyKmPerLitre: efficiency,
      fuelUsedLitres,
      fuelPricePerLitre: fuelPrice,
      fuelCost,
    };

    this.logger?.debug('[FuelAdvisorService] Trip fuel estimate calculated', result);
    return result;
  }

  /**
   * Combine fuel estimates for all legs in a route.
   *
   * @param {Array<object>} legs route legs with distanceKm values
   * @param {string} vehicleType vehicle efficiency key
   * @param {number} fuelPricePerLitre current fuel price override
   * @returns {object} aggregate estimate or the first invalid-leg error
   */
  routeFuelEstimate(legs, vehicleType = 'truck', fuelPricePerLitre) {
    if (!Array.isArray(legs)) {
      this.logger?.debug('[FuelAdvisorService] Invalid route legs supplied');
      return { success: false, error: 'legs must be an array' };
    }

    if (legs.length === 0) {
      return {
        success: true,
        legs: 0,
        distanceKm: 0,
        fuelUsedLitres: 0,
        fuelCost: 0,
        vehicleType: String(vehicleType || '').toLowerCase(),
      };
    }

    const estimates = legs.map((leg, index) => {
      const distance = typeof leg === 'number' ? leg : leg?.distanceKm ?? leg?.distance ?? leg?.distance_km;
      const price = leg && typeof leg === 'object'
        ? leg.fuelPricePerLitre ?? fuelPricePerLitre
        : fuelPricePerLitre;
      const estimate = this.tripFuelEstimate(distance, vehicleType, price);
      return { ...estimate, legIndex: index };
    });
    const failure = estimates.find(estimate => !estimate.success);

    if (failure) {
      return failure;
    }

    const result = {
      success: true,
      legs: estimates.length,
      distanceKm: estimates.reduce((total, estimate) => total + estimate.distanceKm, 0),
      fuelUsedLitres: estimates.reduce((total, estimate) => total + estimate.fuelUsedLitres, 0),
      fuelCost: estimates.reduce((total, estimate) => total + estimate.fuelCost, 0),
      vehicleType: estimates[0].vehicleType,
      fuelPricePerLitre: fuelPricePerLitre ?? estimates[0].fuelPricePerLitre,
      estimates,
    };

    this.logger?.info('[FuelAdvisorService] Route fuel estimate calculated', result);
    return result;
  }

  /**
   * Calculates fuel efficiency with NaN guard and safe fallback.
   */
  calculateFuelEfficiency(distance, fuelAmount, options) {
    return calculateFuelEfficiency(distance, fuelAmount, options);
  }

  static calculateFuelEfficiency(distance, fuelAmount, options) {
    return calculateFuelEfficiency(distance, fuelAmount, options);
  }

  /**
   * Recommend a biodiesel blend for a specific truck and destination.
   * 
   * @param {string} truckId - The ID of the truck
   * @param {number} destinationLat - Destination latitude
   * @param {number} destinationLng - Destination longitude
   * @returns {Promise<Object>} Recommendation payload
   */
  async getFuelRecommendation(truckId, destinationLat, destinationLng) {
    this.logger?.info(`[FuelAdvisorService] Computing recommendation for truck ${truckId} heading to ${destinationLat},${destinationLng}`);

    // 1. Get average engine load from recent telemetry
    const avgEngineLoad = await this._getAverageEngineLoad(truckId);

    // 2. Get weather forecast for destination
    const weather = await this._getWeatherSafely(destinationLat, destinationLng);
    if (!weather || !Number.isFinite(weather.temperature_c)) {
      this.logger?.warn('[FuelAdvisorService] Weather service unavailable or returned invalid data — using safe default B20.');
      return {
        recommended_blend: 'B20',
        reasoning: 'Weather forecast unavailable. B20 is recommended as the safest default blend for all conditions.',
        risk_level: 'LOW',
        factors: { weather_forecast: null, average_engine_load_percent: Math.round(avgEngineLoad) },
      };
    }
    const tempC = weather.temperature_c;

    // 3. Compute recommendation
    // Temp <= 0C AND Load < 60% -> B5 (Low temp, low load -> high risk of gelling & DPF clog)
    // Temp <= 0C AND Load >= 60% -> B20 (Engine runs hot enough) or B10. Let's recommend B20 for max savings if load is high.
    // Temp > 0C -> B20 (Warmer weather, no risk)
    
    let blend = 'B20';
    let reasoning = 'Weather is warm enough for B20 Biodiesel, which offers cost savings and lower emissions.';
    let riskLevel = 'LOW';

    if (tempC <= 0) {
      if (avgEngineLoad < 60) {
        blend = 'B5';
        reasoning = 'Sub-zero temperatures expected and recent engine load is low. B5 is recommended to prevent fuel gelling and DPF clogging.';
        riskLevel = 'HIGH';
      } else {
        blend = 'B20';
        reasoning = 'Sub-zero temperatures expected, but high average engine load will maintain sufficient heat to prevent B20 gelling.';
        riskLevel = 'MEDIUM';
      }
    }

    return {
      recommended_blend: blend,
      reasoning,
      risk_level: riskLevel,
      factors: {
        weather_forecast: weather,
        average_engine_load_percent: Math.round(avgEngineLoad)
      }
    };
  }

  /**
   * Fetches a weather forecast without letting provider failures crash the
   * recommendation, which deliberately degrades to a safe default. A throwing
   * external API must not take down the whole fueling-advisor endpoint.
   */
  async _getWeatherSafely(destinationLat, destinationLng) {
    try {
      return await this.weatherService.getWeatherForecast(destinationLat, destinationLng);
    } catch (err) {
      this.logger?.warn(`[FuelAdvisorService] Weather service failed: ${err?.message ?? String(err)}`);
      return null;
    }
  }

  /**
   * Fetches recent trip events for the truck's active trip and calculates avg load.
   * If no data is available, returns a default value (e.g., 50%).
   */
  async _getAverageEngineLoad(truckId) {
    try {
      // Find the most recent active trip for this truck
      // We look up orders assigned to this truck. Wait, trips table has driver_id.
      // Orders have truck_id. Let's find the active order for the truck.
      const { data: order, error: orderErr } = await this.supabase
        .from('orders')
        .select('id, driver_id')
        .eq('truck_id', truckId)
        .in('status', ['active', 'in_transit', 'en_route_pickup'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (orderErr || !order) {
        this.logger?.debug(`[FuelAdvisorService] No active order found for truck ${truckId}, assuming default load`);
        return 50; // Default load if no active trip
      }

      // Resolve the active trip for this order. trip_events.trip_id references
      // trips.id (not orders.id), so we must look up the trip first.
      const { data: trip, error: tripErr } = await this.supabase
        .from('trips')
        .select('id')
        .eq('order_id', order.id)
        .maybeSingle();

      if (tripErr || !trip) {
        this.logger?.debug(`[FuelAdvisorService] No trip found for order ${order.id}, assuming default load`);
        return 50; // Default load if no trip exists yet
      }

      // Find recent gpsUpdate events in trip_events for this trip
      const { data: events, error: eventsErr } = await this.supabase
        .from('trip_events')
        .select('metadata')
        .eq('trip_id', trip.id)
        .eq('event_type', 'gpsUpdate')
        .order('event_timestamp', { ascending: false })
        .limit(50);

      if (eventsErr || !events || events.length === 0) {
        return 50; // Default load
      }

      // Extract engineLoad from metadata and average
      let totalLoad = 0;
      let count = 0;

      for (const event of events) {
        const load = event.metadata?.engineLoad;
        if (load !== undefined && load !== null && typeof load === 'number') {
          totalLoad += load;
          count++;
        }
      }

      return count > 0 ? totalLoad / count : 50;
    } catch (err) {
      this.logger?.error(`[FuelAdvisorService] Error computing engine load: ${err?.message ?? String(err)}`);
      return 50; // Fallback
    }
  }
}
