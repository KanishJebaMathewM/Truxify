import { DomainError } from './order/domainError.js';

/**
 * Calculates fuel efficiency (distance per litre).
 * 
 * @param {number|string} distanceKm - Distance traveled in kilometers
 * @param {number|string} fuelUsedLitres - Fuel consumed in litres
 * @param {Object|number} [options={}] - Options object or fallback number
 * @returns {number} Efficiency in km/litre
 */
export function calculateFuelEfficiency(distanceKm, fuelUsedLitres, options = {}) {
  const opts = typeof options === 'number' ? { fallback: options } : options;
  const { fallback = 0, throwOnError = false } = opts;

  const dist = Number(distanceKm);
  const fuel = Number(fuelUsedLitres);

  const isValidInput = 
    Number.isFinite(dist) && 
    Number.isFinite(fuel) && 
    dist >= 0 && 
    fuel > 0;

  if (!isValidInput) {
    if (throwOnError) {
      throw new DomainError('Invalid distance or fuel amount for efficiency calculation');
    }
    return fallback;
  }

  return Number((dist / fuel).toFixed(2));
}

export class FuelAdvisorService {
  constructor({ supabase, weatherService, logger, fuelPrices = {}, fuelEfficiency = {} } = {}) {
    this.supabase = supabase;
    this.weatherService = weatherService;
    this.logger = logger || {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    this.fuelPrices = {
      truck: 100,
      van: 90,
      car: 95,
      default: 100,
      ...fuelPrices,
    };
    this.fuelEfficiency = {
      truck: 3.5,
      van: 8,
      car: 12,
      ...fuelEfficiency,
    };
  }

  static calculateFuelEfficiency(distanceKm, fuelUsedLitres, options) {
    return calculateFuelEfficiency(distanceKm, fuelUsedLitres, options);
  }

  calculateFuelEfficiency(distanceKm, fuelUsedLitres, options) {
    return FuelAdvisorService.calculateFuelEfficiency(distanceKm, fuelUsedLitres, options);
  }

  tripFuelEstimate(distanceKm, vehicleType, fuelPricePerLitre) {
    const dist = Number(distanceKm);
    if (distanceKm == null || Number.isNaN(dist) || !Number.isFinite(dist) || dist < 0) {
      this.logger.debug('[FuelAdvisorService] Invalid trip distance supplied');
      return {
        success: false,
        error: 'distanceKm must be a non-negative finite number',
      };
    }

    const normalizedVehicle = typeof vehicleType === 'string' ? vehicleType.toLowerCase() : vehicleType;
    const efficiency = this.fuelEfficiency[normalizedVehicle];
    if (!efficiency) {
      this.logger.debug(`[FuelAdvisorService] Unsupported vehicle type: ${vehicleType}`);
      return {
        success: false,
        error: `Unsupported vehicle type: ${vehicleType}`,
      };
    }

    let resolvedPrice = fuelPricePerLitre;
    if (resolvedPrice == null) {
      resolvedPrice = this.fuelPrices[normalizedVehicle] ?? this.fuelPrices.default;
    }

    const price = Number(resolvedPrice);
    if (Number.isNaN(price) || !Number.isFinite(price) || price < 0) {
      this.logger.debug('[FuelAdvisorService] Fuel price is unavailable');
      return {
        success: false,
        error: 'fuelPricePerLitre must be a finite non-negative number',
      };
    }

    const fuelUsedLitres = Number((dist / efficiency).toFixed(2));
    const fuelCost = Number((fuelUsedLitres * price).toFixed(2));

    const result = {
      success: true,
      distanceKm: dist,
      vehicleType: normalizedVehicle,
      fuelEfficiencyKmPerLitre: efficiency,
      fuelUsedLitres,
      fuelPricePerLitre: price,
      fuelCost,
    };

    this.logger.debug('[FuelAdvisorService] Trip fuel estimate calculated', result);
    return result;
  }

  routeFuelEstimate(legs, vehicleType, routeFuelPricePerLitre) {
    if (!Array.isArray(legs)) {
      return { success: false, error: 'legs must be an array' };
    }

    let totalDistance = 0;
    let totalFuel = 0;
    let totalCost = 0;
    const estimates = [];

    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      if (leg == null) {
        return { success: false, error: 'distanceKm must be a non-negative finite number', legIndex: i };
      }

      const dist = typeof leg === 'number' ? leg : (leg.distanceKm ?? leg.distance ?? leg.distance_km);
      const legPrice = leg.fuelPricePerLitre ?? routeFuelPricePerLitre;

      const estimate = this.tripFuelEstimate(dist, vehicleType, legPrice);
      if (!estimate.success) {
        return { ...estimate, legIndex: i };
      }

      totalDistance += estimate.distanceKm;
      totalFuel += estimate.fuelUsedLitres;
      totalCost += estimate.fuelCost;
      estimates.push(estimate);
    }

    const aggregated = {
      success: true,
      legs: legs.length,
      distanceKm: Number(totalDistance.toFixed(2)),
      fuelUsedLitres: Number(totalFuel.toFixed(2)),
      fuelCost: Number(totalCost.toFixed(2)),
      vehicleType: typeof vehicleType === 'string' ? vehicleType.toLowerCase() : vehicleType,
      fuelPricePerLitre: routeFuelPricePerLitre,
      estimates,
    };

    this.logger.info('[FuelAdvisorService] Route fuel estimate calculated', aggregated);
    return aggregated;
  }

  async getFuelRecommendation(truckId, lat, lon) {
    let weather = null;
    try {
      if (this.weatherService && typeof this.weatherService.getWeatherForecast === 'function') {
        weather = await this.weatherService.getWeatherForecast(lat, lon);
      }
    } catch (err) {
      this.logger.warn(`[FuelAdvisorService] Weather service error: ${err.message}`);
    }

    const avgEngineLoad = await this._getAverageEngineLoad(truckId);

    if (!weather || typeof weather.temperature_c !== 'number' || Number.isNaN(weather.temperature_c)) {
      this.logger.warn('[FuelAdvisorService] Weather service unavailable or returned invalid data');
      return {
        recommended_blend: 'B20',
        risk_level: 'LOW',
        reasoning: 'Weather forecast unavailable. Defaulting to standard B20 blend.',
        factors: {
          average_engine_load_percent: avgEngineLoad,
          weather_forecast: null,
        },
      };
    }

    const temp = weather.temperature_c;
    if (temp <= 0 && avgEngineLoad < 60) {
      return {
        recommended_blend: 'B5',
        risk_level: 'HIGH',
        reasoning: 'Sub-zero temperatures expected and recent engine load is low.',
        factors: {
          average_engine_load_percent: avgEngineLoad,
          weather_forecast: weather,
        },
      };
    } else if (temp <= 0 && avgEngineLoad >= 60) {
      return {
        recommended_blend: 'B20',
        risk_level: 'MEDIUM',
        reasoning: 'Sub-zero temperatures expected, but high average engine load will maintain sufficient heat.',
        factors: {
          average_engine_load_percent: avgEngineLoad,
          weather_forecast: weather,
        },
      };
    }

    return {
      recommended_blend: 'B20',
      risk_level: 'LOW',
      reasoning: 'Weather is warm enough for standard operation.',
      factors: {
        average_engine_load_percent: avgEngineLoad,
        weather_forecast: weather,
      },
    };
  }

  async _getAverageEngineLoad(truckId) {
    try {
      if (!this.supabase) return 50;

      const orderRes = await this.supabase
        .from('orders')
        .select('id, driver_id')
        .eq('truck_id', truckId)
        .in('status', ['in_progress', 'active'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (orderRes.error || !orderRes.data) return 50;

      const tripRes = await this.supabase
        .from('trips')
        .select('id')
        .eq('order_id', orderRes.data.id)
        .maybeSingle();

      if (tripRes.error || !tripRes.data) return 50;

      const eventsRes = await this.supabase
        .from('trip_events')
        .select('metadata')
        .eq('trip_id', tripRes.data.id)
        .order('timestamp', { ascending: false })
        .limit(20);

      if (eventsRes.error || !Array.isArray(eventsRes.data) || eventsRes.data.length === 0) {
        return 50;
      }

      const loads = eventsRes.data
        .map(e => e?.metadata?.engineLoad)
        .filter(val => typeof val === 'number' && !Number.isNaN(val));

      if (loads.length === 0) return 50;

      const sum = loads.reduce((acc, val) => acc + val, 0);
      return Math.round(sum / loads.length);
    } catch (err) {
      this.logger.error(`[FuelAdvisorService] Error computing engine load: ${err.message}`);
      return 50;
    }
  }
}
