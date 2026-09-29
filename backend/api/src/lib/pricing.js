/**
 * Server-side freight pricing.
 *
 * Single source of truth for monetary fields on orders and load offers.
 * Replaces the previous behaviour where the client (the customer) supplied
 * `base_freight`, `toll_estimate`, `platform_fee`, and `total_amount`
 * directly in the request body, and the server persisted them verbatim.
 *
 * Pricing inputs come from the route handler (distance, weight, goods type)
 * — never from the request body — and are run through a rate card that is
 * configurable via environment variables.
 *
 * All amounts are returned in **paisa** (1 INR = 100 paisa) to match the
 * integer column types already used elsewhere in the schema (e.g.
 * `load_bids.bid_amount` is documented as paisa in orderRoutes.js:215).
 */

import logger from '../middleware/logger.js';

// Floor and ceiling for a single freight price in paisa (1 INR = 100 paisa).
// Negative/NaN/Infinity clamp to the floor (0); the ceiling is ₹10,00,000.
const MIN_FREIGHT_PAISa = 0;
const MAX_FREIGHT_PAISa = 100_000_000;

export function sanitizePrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return MIN_FREIGHT_PAISa;
  return Math.round(Math.min(MAX_FREIGHT_PAISa, num));
}

import { EARTH_RADIUS_KM, haversineDistance } from '../utils/coordinates.js';

// Pricing constants (all amounts in paisa unless noted)
const TOLL_ESCALATION_HOURS = 6;
const DEFAULT_RATE_PER_TONNE_KM = 50; // paisa per tonne-km

const DEFAULTS = Object.freeze({
  RATE_PER_TONNE_KM: 50,    // paisa per tonne-km, base rate
  FRAGILE_MULTIPLIER: 1.5,  // multiplier on the base rate
  STACKABLE_DISCOUNT: 0.9,  // multiplier < 1 to discount stackable cargo
  HANDLING_FEE: 30000,      // paisa (₹300) flat handling fee
  PLATFORM_FEE_PCT: 5,      // percent of base freight
  FUEL_COST_PCT: 45,        // percent of base freight (driver-side cost)
  TOLL_PER_KM: 200,         // paisa per km, proxy for highway toll
});

function parsePositiveInt(raw, fallback, label) {
  if (raw === null || raw === undefined || raw === '') {
    if (label) logger.warn(`[pricing] ${label} is not set — using default ${fallback}`);
    return fallback;
  }
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return n;
  if (label) logger.warn(`[pricing] ${label}=${raw} is invalid — using default ${fallback}`);
  return fallback;
}

function parsePositiveFloat(raw, fallback, label) {
  if (raw === null || raw === undefined || raw === '') {
    if (label) logger.warn(`[pricing] ${label} is not set — using default ${fallback}`);
    return fallback;
  }
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return n;
  if (label) logger.warn(`[pricing] ${label}=${raw} is invalid — using default ${fallback}`);
  return fallback;
}

function readRateCard() {
  return {
    ratePerTonneKm: parsePositiveInt(process.env.TRUXIFY_RATE_PER_TONNE_KM, DEFAULTS.RATE_PER_TONNE_KM, 'TRUXIFY_RATE_PER_TONNE_KM'),
    fragileMultiplier: parsePositiveFloat(process.env.TRUXIFY_FRAGILE_MULTIPLIER, DEFAULTS.FRAGILE_MULTIPLIER, 'TRUXIFY_FRAGILE_MULTIPLIER'),
    stackableDiscount: parsePositiveFloat(process.env.TRUXIFY_STACKABLE_DISCOUNT, DEFAULTS.STACKABLE_DISCOUNT, 'TRUXIFY_STACKABLE_DISCOUNT'),
    handlingFee: parsePositiveInt(process.env.TRUXIFY_HANDLING_FEE, DEFAULTS.HANDLING_FEE, 'TRUXIFY_HANDLING_FEE'),
    platformFeePct: parsePositiveInt(process.env.TRUXIFY_PLATFORM_FEE_PCT, DEFAULTS.PLATFORM_FEE_PCT, 'TRUXIFY_PLATFORM_FEE_PCT'),
    fuelCostPct: parsePositiveInt(process.env.TRUXIFY_FUEL_COST_PCT, DEFAULTS.FUEL_COST_PCT, 'TRUXIFY_FUEL_COST_PCT'),
    tollPerKm: parsePositiveInt(process.env.TRUXIFY_TOLL_PER_KM, DEFAULTS.TOLL_PER_KM, 'TRUXIFY_TOLL_PER_KM'),
  };
}

/**
 * Great-circle distance between two lat/lng points in kilometres.
 * Returns 0 for identical points. Suitable as a baseline for freight
 * pricing; for production routing accuracy integrate OSRM / Mapbox /
 * Google Directions and pass the actual road distance in instead.
 */
export function haversineKm(lat1, lon1, lat2, lon2) {
  try {
    return haversineDistance(lat1, lon1, lat2, lon2, 'km');
  } catch (err) {
    if (err instanceof TypeError) {
      throw new TypeError('haversineKm requires finite numeric lat/lng arguments', { cause: err });
    }
    throw err;
  }
}

/**
 * Guard against NaN and Infinity in numeric pricing fields.
 * If any arithmetic result is not finite or negative, returns a safe fallback of 0.
 */
export function safePaisa(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num);
}

/**
 * Compute the canonical pricing for an order.
 *
 * @param {object} input
 * @param {number} input.pickupLat   - decimal degrees
 * @param {number} input.pickupLng   - decimal degrees
 * @param {number} input.dropLat     - decimal degrees
 * @param {number} input.dropLng     - decimal degrees
 * @param {number} input.weightTonnes - cargo weight in tonnes (> 0)
 * @param {number} [input.roadDistanceKm] - routed road distance in kilometres
 * @param {boolean} [input.isFragile] - fragile cargo multiplier
 * @param {boolean} [input.isStackable] - stackable cargo discount
 * @param {object} [rateCard] - override rate card (mainly for tests)
 * @returns {object} pricing breakdown in paisa
 * @throws {RangeError|TypeError} on invalid inputs
 */
export function computeOrderPricing(input, rateCard = readRateCard()) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('computeOrderPricing requires an input object');
  }

  // Validate rate card at call time
  if (!rateCard.ratePerTonneKm || rateCard.ratePerTonneKm <= 0) {
    throw new RangeError(`ratePerTonneKm must be > 0, got ${rateCard.ratePerTonneKm}`);
  }
  if (rateCard.handlingFee != null && rateCard.handlingFee < 0) {
    throw new RangeError(`handlingFee must be >= 0, got ${rateCard.handlingFee}`);
  }

  const {
    pickupLat, pickupLng, dropLat, dropLng,
    weightTonnes, roadDistanceKm, isFragile = false, isStackable = false,
    tollFactor = 1,
  } = input;

  // Guard tollFactor against NaN/undefined: treat invalid values as 1 (no extra toll).
  const safeTollFactor = Number.isFinite(tollFactor) && tollFactor >= 0 ? tollFactor : 1;

  if (!Number.isFinite(weightTonnes) || weightTonnes <= 0) {
    throw new RangeError(`weightTonnes must be a positive number, got ${weightTonnes}`);
  }

  if (pickupLat == null || pickupLng == null || dropLat == null || dropLng == null) {
    throw new TypeError('computeOrderPricing: pickupLat, pickupLng, dropLat, and dropLng are required and cannot be null');
  }

  const fallbackDistanceKm = haversineKm(pickupLat, pickupLng, dropLat, dropLng);
  const distanceKm = Number.isFinite(roadDistanceKm) && roadDistanceKm >= 0
    ? roadDistanceKm
    : fallbackDistanceKm;
  const safeDistanceKm = Number.isFinite(distanceKm) && distanceKm >= 0 ? distanceKm : 0;

  // Base rate scaled by goods class.
  let rate = rateCard.ratePerTonneKm;
  if (isFragile) rate *= (Number.isFinite(rateCard.fragileMultiplier) ? rateCard.fragileMultiplier : 1);
  if (isStackable) rate *= (Number.isFinite(rateCard.stackableDiscount) ? rateCard.stackableDiscount : 1);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError(`Computed rate-per-tonne-km must be > 0, got ${rate}`);
  }

  const handlingFee = Number.isFinite(rateCard.handlingFee) && rateCard.handlingFee >= 0 ? rateCard.handlingFee : 0;
  const tollPerKm = Number.isFinite(rateCard.tollPerKm) && rateCard.tollPerKm >= 0 ? rateCard.tollPerKm : 0;
  const platformFeePct = Number.isFinite(rateCard.platformFeePct) && rateCard.platformFeePct >= 0 ? rateCard.platformFeePct : 0;
  const fuelCostPct = Number.isFinite(rateCard.fuelCostPct) && rateCard.fuelCostPct >= 0 ? rateCard.fuelCostPct : 0;

  const baseFreight = safePaisa(rate * weightTonnes * safeDistanceKm + handlingFee);
  const tollEstimate = safePaisa(tollPerKm * safeDistanceKm * safeTollFactor);
  const platformFee = safePaisa((baseFreight * platformFeePct) / 100);
  const totalAmount = safePaisa(baseFreight + tollEstimate + platformFee);

  // Driver-side cost / margin hints persisted on load_offers.
  // The toll is a pass-through cost recovered from the customer on the revenue
  // side (totalAmount includes tollEstimate), so it must not be subtracted a
  // second time as a driver expense.
  const fuelCost = safePaisa((baseFreight * fuelCostPct) / 100);
  const netProfitRaw = baseFreight - fuelCost;
  const netProfit = Number.isFinite(netProfitRaw) ? Math.round(netProfitRaw) : 0;

  // Final isFinite validation guards on all computed price outputs
  return {
    distanceKm: Number.isFinite(distanceKm) ? Math.round(distanceKm * 100 + Number.EPSILON) / 100 : 0,
    baseFreight: Number.isFinite(baseFreight) ? baseFreight : 0,
    tollEstimate: Number.isFinite(tollEstimate) ? tollEstimate : 0,
    platformFee: Number.isFinite(platformFee) ? platformFee : 0,
    totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
    fuelCost: Number.isFinite(fuelCost) ? fuelCost : 0,
    netProfit: Number.isFinite(netProfit) ? netProfit : 0,
  };
}

export function convertKmToMiles(km) {
  if (typeof km !== 'number' || Number.isNaN(km) || !Number.isFinite(km)) {
    throw new TypeError('km must be a finite number');
  }
  if (km < 0) {
    throw new RangeError('km must be non-negative');
  }
  return km * 0.621371;
}

export const __testing = { DEFAULTS, readRateCard, EARTH_RADIUS_KM, parsePositiveFloat, safePaisa };


// === Spec 10: ===
// === Spec 10: non-negative validation ===
export function guardNonNegative(value, label = 'value') {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite, got ${value}`);
  if (value < 0) return 0;
  return value;
}

