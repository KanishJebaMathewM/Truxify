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
  constructor({ supabase, weatherService, logger, fuelPrices = {}, fuelEfficiency = {} } = {}) {
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
