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

const EARTH_RADIUS_KM = 6371.0088;

const DEFAULTS = Object.freeze({
  RATE_PER_TONNE_KM: 50,    // paisa per tonne-km, base rate
  FRAGILE_MULTIPLIER: 1.5,  // multiplier on the base rate
  STACKABLE_DISCOUNT: 0.9,  // multiplier < 1 to discount stackable cargo
  HANDLING_FEE: 30000,      // paisa (₹300) flat handling fee
  PLATFORM_FEE_PCT: 5,      // percent of base freight
  FUEL_COST_PCT: 45,        // percent of base freight (driver-side cost)
  TOLL_PER_KM: 200,         // paisa per km, proxy for highway toll
});

function readRateCard() {
  return {
    ratePerTonneKm: Number(process.env.TRUXIFY_RATE_PER_TONNE_KM ?? DEFAULTS.RATE_PER_TONNE_KM),
    fragileMultiplier: Number(process.env.TRUXIFY_FRAGILE_MULTIPLIER ?? DEFAULTS.FRAGILE_MULTIPLIER),
    stackableDiscount: Number(process.env.TRUXIFY_STACKABLE_DISCOUNT ?? DEFAULTS.STACKABLE_DISCOUNT),
    handlingFee: Number(process.env.TRUXIFY_HANDLING_FEE ?? DEFAULTS.HANDLING_FEE),
    platformFeePct: Number(process.env.TRUXIFY_PLATFORM_FEE_PCT ?? DEFAULTS.PLATFORM_FEE_PCT),
    fuelCostPct: Number(process.env.TRUXIFY_FUEL_COST_PCT ?? DEFAULTS.FUEL_COST_PCT),
    tollPerKm: Number(process.env.TRUXIFY_TOLL_PER_KM ?? DEFAULTS.TOLL_PER_KM),
  };
}

/**
 * Great-circle distance between two lat/lng points in kilometres.
 * Returns 0 for identical points. Suitable as a baseline for freight
 * pricing; for production routing accuracy integrate OSRM / Mapbox /
 * Google Directions and pass the actual road distance in instead.
 */
export function haversineKm(lat1, lon1, lat2, lon2) {
  if (
    !Number.isFinite(lat1) || !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) || !Number.isFinite(lon2)
  ) {
    throw new TypeError('haversineKm requires finite numeric lat/lng arguments');
  }
  if (lat1 === lat2 && lon1 === lon2) return 0;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
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
  const {
    pickupLat, pickupLng, dropLat, dropLng,
    weightTonnes, isFragile = false, isStackable = false,
  } = input;

  if (!Number.isFinite(weightTonnes) || weightTonnes <= 0) {
    throw new RangeError(`weightTonnes must be a positive number, got ${weightTonnes}`);
  }

  const distanceKm = haversineKm(pickupLat, pickupLng, dropLat, dropLng);

  // Base rate scaled by goods class.
  let rate = rateCard.ratePerTonneKm;
  if (isFragile) rate *= rateCard.fragileMultiplier;
  if (isStackable) rate *= rateCard.stackableDiscount;
  if (rate <= 0) {
    throw new RangeError(`Computed rate-per-tonne-km must be > 0, got ${rate}`);
  }

  const baseFreight = Math.round(rate * weightTonnes * distanceKm) + rateCard.handlingFee;
  const tollEstimate = Math.round(rateCard.tollPerKm * distanceKm);
  const platformFee = Math.round((baseFreight * rateCard.platformFeePct) / 100);
  const totalAmount = baseFreight + tollEstimate + platformFee;

  // Driver-side cost / margin hints persisted on load_offers.
  const fuelCost = Math.round((baseFreight * rateCard.fuelCostPct) / 100);
  const netProfit = baseFreight - fuelCost - tollEstimate;

  return {
    distanceKm: Math.round(distanceKm * 100) / 100, // 2-decimal precision
    baseFreight,
    tollEstimate,
    platformFee,
    totalAmount,
    fuelCost,
    netProfit,
  };
}

export const __testing = { DEFAULTS, readRateCard, EARTH_RADIUS_KM };
