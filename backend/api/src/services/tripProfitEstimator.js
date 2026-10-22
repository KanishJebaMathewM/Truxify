/**
 * Deterministic trip profit estimator for the Driver App.
 *
 * Computes an estimated net profit breakdown before a driver accepts a load.
 * All values are estimates and are clearly marked as such in the response.
 * The ML-based Driver Profit Predictor can later replace or supplement these
 * calculations without changing the public API shape.
 */

/**
 * Default configuration constants for profit estimation.
 * These represent typical values for a 2-axle commercial truck on Indian NHs.
 *
 * @type {TripProfitConfig}
 */
export const DEFAULT_PROFIT_CONFIG = {
  /** Diesel fuel price in ₹/litre */
  fuelPricePerLitre: 92,
  /** Truck mileage in km/litre */
  truckKmPerLitre: 4,
  /** Toll rate in ₹/km — approximates NHAI 2-axle rate averaged across corridors */
  tollRatePerKm: 3,
  /** Miscellaneous trip expenses in ₹/km (driver allowance, loading help, etc.) */
  otherCostPerKm: 1.5,
};

/**
 * @typedef {object} TripProfitConfig
 * @property {number} fuelPricePerLitre  - ₹ per litre of diesel
 * @property {number} truckKmPerLitre    - km per litre (truck mileage)
 * @property {number} tollRatePerKm      - ₹ per km for tolls
 * @property {number} otherCostPerKm     - ₹ per km for miscellaneous expenses
 */

/**
 * @typedef {object} TripProfitBreakdown
 * @property {number} freightAmount      - Total freight in ₹
 * @property {number} estimatedFuelCost  - Estimated fuel cost in ₹
 * @property {number} estimatedTollCost  - Estimated toll cost in ₹
 * @property {number} otherCosts         - Other estimated trip expenses in ₹
 * @property {number} estimatedNetProfit - Estimated net profit in ₹
 * @property {number} profitPerKm        - ₹ profit per kilometre
 * @property {number} distanceKm         - Estimated trip distance in km
 * @property {boolean} isEstimate        - Always true; consumers must display this label
 */

/**
 * Coerce a raw value to a finite non-negative number, or return the fallback.
 *
 * @param {unknown} value
 * @param {number} [fallback=0]
 * @returns {number}
 */
export function toFinitePositive(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Calculate an estimated trip profit breakdown.
 *
 * Missing or invalid inputs never throw — they fall back to zero so callers
 * can safely display partial breakdowns ("Missing cost data does not crash
 * the application" acceptance criterion).
 *
 * @param {object} params
 * @param {number} params.freightAmountInr  - Total freight in ₹ (not paisa)
 * @param {number} params.distanceKm        - Route distance in kilometres
 * @param {Partial<TripProfitConfig>} [params.config] - Override defaults
 * @returns {TripProfitBreakdown}
 */
export function estimateTripProfit(input = {}) {
  // The function promises not to throw on missing data. Destructuring null (or
  // a non-object) and then reading properties from a null config violated that
  // contract for a common "no pricing data yet" request shape.
  const params = input && typeof input === 'object' ? input : {};
  const { freightAmountInr, distanceKm } = params;
  const overrides = params.config && typeof params.config === 'object' ? params.config : {};

  const freight = toFinitePositive(freightAmountInr);
  const distance = toFinitePositive(distanceKm);

  const cfg = {
    fuelPricePerLitre: toFinitePositive(overrides.fuelPricePerLitre, DEFAULT_PROFIT_CONFIG.fuelPricePerLitre),
    truckKmPerLitre:   toFinitePositive(overrides.truckKmPerLitre,   DEFAULT_PROFIT_CONFIG.truckKmPerLitre),
    tollRatePerKm:     toFinitePositive(overrides.tollRatePerKm,     DEFAULT_PROFIT_CONFIG.tollRatePerKm),
    otherCostPerKm:    toFinitePositive(overrides.otherCostPerKm,    DEFAULT_PROFIT_CONFIG.otherCostPerKm),
  };

  // Guard against zero mileage — avoid division by zero
  const kmPerLitre = cfg.truckKmPerLitre > 0 ? cfg.truckKmPerLitre : DEFAULT_PROFIT_CONFIG.truckKmPerLitre;

  const estimatedFuelCost  = (distance / kmPerLitre) * cfg.fuelPricePerLitre;
  const estimatedTollCost  = distance * cfg.tollRatePerKm;
  const otherCosts         = distance * cfg.otherCostPerKm;
  const totalCosts         = estimatedFuelCost + estimatedTollCost + otherCosts;
  const estimatedNetProfit = freight - totalCosts;
  const profitPerKm        = distance > 0 ? estimatedNetProfit / distance : 0;

  return {
    freightAmount:      round2(freight),
    estimatedFuelCost:  round2(estimatedFuelCost),
    estimatedTollCost:  round2(estimatedTollCost),
    otherCosts:         round2(otherCosts),
    estimatedNetProfit: round2(estimatedNetProfit),
    profitPerKm:        round2(profitPerKm),
    distanceKm:         round2(distance),
    isEstimate:         true,
  };
}

/**
 * Round a number to 2 decimal places.
 *
 * @param {number} n
 * @returns {number}
 */
function round2(n) {
  return Math.round(n * 100) / 100;
}

const tripProfitEstimator = {
  estimateTripProfit,
  toFinitePositive,
  DEFAULT_PROFIT_CONFIG,
};

export default tripProfitEstimator;
