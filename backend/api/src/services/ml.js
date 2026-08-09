import logger from '../middleware/logger.js';
import { validatePricePrediction, convertToPaisa, RejectionReason } from '../lib/predictionValidator.js';
import { LRUCache } from '../utils/cache.js';

const demandCache = new LRUCache(100, 15 * 60 * 1000);
const priceCache = new LRUCache(100, 15 * 60 * 1000);

// Single source of truth for ML engine base URL
const DEFAULT_ML_ENGINE_URL = 'http://localhost:8001';

const ML_HTTP_TIMEOUT_MS = 5000;
const ML_HTTP_TIMEOUT_MS_HEAVY = 10000;
const ML_HTTP_TIMEOUT_MS_LONG = 300000;
const ML_DEFAULT_PICKUP_LEAD_MS = 8 * 60 * 60 * 1000;
const DEFAULT_TRUCK_MAX_WEIGHT_KG = 25000;
const DEFAULT_TRUCK_MAX_LENGTH_M = 12;
const DEFAULT_TRUCK_MAX_WIDTH_M = 2.5;
const DEFAULT_TRUCK_MAX_HEIGHT_M = 4;

// Startup validation
if (!process.env.ML_API_KEY) {
    logger.warn('[ML] WARNING: ML_API_KEY is not set. All ML API endpoints will return 503. Set ML_API_KEY in your environment.');
}

/**
 * Parse the free-text `weight` column of load_offers (e.g. '3 tonnes') into
 * kilograms. Returns NaN when the value cannot be interpreted.
 */
function parseWeightKg(weight) {
  if (typeof weight !== 'string') {
    const num = Number(weight);
    return Number.isFinite(num) ? num : NaN;
  }
  const match = weight.toLowerCase().match(/([\d.]+)\s*(kg|ton|tonne|t)\b/);
  if (!match) return NaN;
  const value = Number(match[1]);
  return match[2] === 'kg' ? value : value * 1000;
}

function parseWeightKgSafe(weight) {
  const result = parseWeightKg(weight);
  if (Number.isNaN(result)) {
    logger.warn(`[ML] parseWeightKg received unparseable weight: ${weight}`);
    return 0;
  }
  return result;
}

/**
 * Parse the free-text `dimensions` column of load_offers (e.g. '12 X 6 X 6 ft')
 * into length/width/height in meters. Falls back to 1 m per dimension when
 * fewer than three values are present.
 */
function parseDimensions(dimensions) {
  const fallback = { length: 1, width: 1, height: 1 };
  if (typeof dimensions !== 'string') return fallback;
  const numbers = (dimensions.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (numbers.length < 3) return fallback;
  const ftToM = dimensions.toLowerCase().includes('ft') ? 0.3048 : 1;
  const [length, width, height] = numbers;
  return {
    length: Number((length * ftToM).toFixed(2)),
    width: Number((width * ftToM).toFixed(2)),
    height: Number((height * ftToM).toFixed(2)),
  };
}

function guardMlApiKey() {
  if (!process.env.ML_API_KEY) {
    throw new Error("[ML] ML_API_KEY is not configured. All ML endpoints will return 503. Set ML_API_KEY to enable ML features.");
  }
}

/**
 * Utility: build headers with optional API key
 */
function getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.ML_API_KEY) {
        headers['X-API-Key'] = process.env.ML_API_KEY;
    }

    if (response.status === 401) {
      throw new Error(`[MLService] Unauthorized (401) for ${method} ${url}`);
    }

    if (response.status === 403) {
      throw new Error(`[MLService] Forbidden (403) for ${method} ${url}`);
    }

  const result = await handleResponse(response);

  if (
    result == null ||
    typeof result.predicted_profit !== 'number' ||
    !isFinite(result.predicted_profit)
  ) {
    throw new Error('[ML] Invalid driver profit prediction: missing or non-finite predicted_profit');
  }

  if (result.confidence_interval == null || typeof result.confidence_interval !== 'object') {
    throw new Error('[ML] Invalid driver profit prediction: missing confidence_interval');
  }

  return {
    predicted_profit: Math.round(result.predicted_profit * 100) / 100,
    confidence_interval: {
      lower: Math.max(0, Math.round((result.confidence_interval.lower ?? 0) * 100) / 100),
      upper: Math.round((result.confidence_interval.upper ?? result.predicted_profit * 2) * 100) / 100,
    },
    currency: 'INR',
  };
}

/**
 * Optimises packing of packages into a truck with delivery routing.
 *
 * @param {object} params
 * @param {Array<{length: number, width: number, height: number, weight: number}>} params.packages - Packages to pack
 * @param {{length: number, width: number, height: number, max_weight: number}} params.truck - Truck dimensions
 * @param {Array<{lat: number, lng: number}>} params.deliveryAddresses - Delivery stop coordinates
 * @returns {Promise<{packing_arrangement: Array, unpacked_packages: Array, stop_sequence: Array, utilization_pct: number}>}
 * @throws {Error} if ML_API_KEY is missing or HTTP fails
 */
export async function optimisePacking({ packages, truck, deliveryAddresses }) {
  guardMlApiKey();
  const url = `${getBaseUrl()}/optimise/packing`;

  const payload = {
    packages,
    truck,
    delivery_addresses: deliveryAddresses,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(ML_HTTP_TIMEOUT_MS_HEAVY),
  });

  return handleResponse(response);
}

/**
 * Recommends available loads for a user based on collaborative filtering.
 *
 * @param {object} params
 * @param {string}   params.userId         - User ID
 * @param {Array}    [params.bookingHistory] - Past booking history entries
 * @param {Array}    [params.ratedDrivers]   - Previously rated drivers
 * @param {number}   [params.topN=5]         - Number of recommendations (1-50)
 * @returns {Promise<{recommendations: Array}>}
 * @throws {Error} if ML_API_KEY is missing or HTTP fails
 */
export async function recommendLoads({ userId, bookingHistory = [], ratedDrivers = [], topN = 5 }) {
  guardMlApiKey();
  const url = `${getBaseUrl()}/recommend/loads`;

  const payload = {
    user_id: userId,
    booking_history: bookingHistory,
    rated_drivers: ratedDrivers,
    top_n: topN,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(ML_HTTP_TIMEOUT_MS),
  });

  return handleResponse(response);
}

/**
 * Recommends suitable trucks for a user based on collaborative filtering.
 *
 * @param {object} params
 * @param {string}   params.userId         - User ID
 * @param {Array}    [params.bookingHistory] - Past booking history entries
 * @param {Array}    [params.ratedLoads]     - Previously rated loads
 * @param {number}   [params.topN=5]         - Number of recommendations (1-50)
 * @returns {Promise<{recommendations: Array}>}
 * @throws {Error} if ML_API_KEY is missing or HTTP fails
 */
export async function recommendTrucks({ userId, bookingHistory = [], ratedLoads = [], topN = 5 }) {
  guardMlApiKey();
  const url = `${getBaseUrl()}/recommend/trucks`;

  const payload = {
    user_id: userId,
    booking_history: bookingHistory,
    rated_loads: ratedLoads,
    top_n: topN,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(ML_HTTP_TIMEOUT_MS),
  });

  return handleResponse(response);
}

/**
 * Computes a trust score for a driver or customer based on behavioral metrics.
 *
 * @param {object} params
 * @param {number} params.cancellationRate - Cancellation rate (0-1)
 * @param {number} params.onTimePct        - On-time delivery percentage (0-100)
 * @param {number} params.avgRating        - Average rating (1-5)
 * @param {number} params.disputeCount     - Number of disputes (>= 0)
 * @param {boolean} params.isVerified      - Whether the user is verified
 * @returns {Promise<{trust_score: number, risk_category: string}>}
 * @throws {Error} if ML_API_KEY is missing or HTTP fails
 */
export async function scoreTrust({ cancellationRate, onTimePct, avgRating, disputeCount, isVerified }) {
  guardMlApiKey();
  const url = `${getBaseUrl()}/score/trust`;

  const payload = {
    cancellation_rate: cancellationRate,
    on_time_pct: onTimePct,
    avg_rating: avgRating,
    dispute_count: disputeCount,
    is_verified: isVerified,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(ML_HTTP_TIMEOUT_MS),
  });

  return handleResponse(response);
}

/**
 * Finds deadhead (return-trip) loads for a truck to avoid empty backhauls.
 * @param {object} params
 * @param {object} params.driverDestination - { lat, lng }
 * @param {object} params.truckSpecs - { max_weight_kg, max_length_m, max_width_m, max_height_m }
 * @param {string} params.arrivalTime - ISO datetime string
 * @param {Array}  params.availableLoads - list of available load objects
 * @returns {Promise<{recommendations: Array}>}
 */
export async function matchDeadhead({ driverDestination, truckSpecs, arrivalTime, availableLoads }) {
  guardMlApiKey();
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/match/deadhead`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      driver_destination: driverDestination,
      truck_specs: truckSpecs,
      arrival_time: arrivalTime,
      available_loads: availableLoads,
    }),
    signal: AbortSignal.timeout(ML_HTTP_TIMEOUT_MS_HEAVY),
  });
  return handleResponse(response);
}

/**
 * Optimises a mid-trip route based on real-time conditions.
 * @param {object} routeData - { current_location, destination, fuel_level, hours_driven }
 * @returns {Promise<{adjustments: Array, fuel_saving: number}>}
 */
export async function optimiseMidTrip(routeData) {
  guardMlApiKey();
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/optimise/mid-trip`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(routeData),
    signal: AbortSignal.timeout(ML_HTTP_TIMEOUT_MS),
  });
  return handleResponse(response);
}

/**
 * Triggers retraining of the demand prediction model.
 * @param {boolean} [force=false] - Force retrain even if model is current
 * @returns {Promise<{status: string, model_version: string}>}
 */
export async function trainDemandModel(force = false) {
  guardMlApiKey();
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/train/demand`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ force }),
    signal: AbortSignal.timeout(ML_HTTP_TIMEOUT_MS_LONG),
  });
  return handleResponse(response);
}

/**
 * Triggers retraining of the price prediction model.
 * @param {boolean} [force=false] - Force retrain even if model is current
 * @returns {Promise<{status: string, model_version: string}>}
 */
export async function trainPriceModel(force = false) {
  guardMlApiKey();
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/train/price`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ force }),
    signal: AbortSignal.timeout(ML_HTTP_TIMEOUT_MS_LONG),
  });
  return handleResponse(response);
}

/**
 * Lists all available ML models and their versions.
 * @returns {Promise<{models: Array}>}
 */
export async function listModels() {
  guardMlApiKey();
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/models`;
  const response = await fetch(url, {
    method: 'GET',
    headers: getHeaders(),
    signal: AbortSignal.timeout(ML_HTTP_TIMEOUT_MS),
  });
  return handleResponse(response);
}

/**
 * Finds en-route load opportunities for an active driver using the Deadhead
 * Eliminator ML model. When the ML engine is unavailable (no ML_API_KEY,
 * network error, etc.) it falls back to a pure haversine-distance ranking so
 * the endpoint never returns an empty list when offers exist in the DB.
 *
 * @param {object} params
 * @param {number}   params.currentLat       - Driver's current latitude
 * @param {number}   params.currentLng       - Driver's current longitude
 * @param {Array}    params.offers           - Raw load_offer rows from DB
 * @param {object}   [params.truckSpecs]     - Truck capacity; defaults to generous values
 * @param {number}   [params.maxDetourKm=50] - Max acceptable detour in km
 * @returns {Promise<Array>} - offers enriched with detour_km, extra_earnings, match_score
 */
export async function matchEnRouteLoads({
  currentLat,
  currentLng,
  offers,
  truckSpecs,
  maxDetourKm = 50,
}) {
  if (!offers || offers.length === 0) return [];

  // Build the available_loads list the ML model expects. load_offers stores
  // coordinates as pickup_*/drop_*, weight as text ('3 tonnes') and dimensions
  // as text ('12 X 6 X 6 ft'), so normalize those to the numeric fields the
  // model consumes.
  const availableLoads = offers
    .filter(o => o.pickup_lat && o.pickup_lng && o.drop_lat && o.drop_lng)
    .map(o => {
      const dims = parseDimensions(o.dimensions);
      return {
        load_id: o.id,
        origin_lat: Number(o.pickup_lat),
        origin_lng: Number(o.pickup_lng),
        dest_lat: Number(o.drop_lat),
        dest_lng: Number(o.drop_lng),
        weight_kg: parseWeightKg(o.weight),
        length_m: dims.length,
        width_m: dims.width,
        height_m: dims.height,
        pickup_deadline: o.pickup_deadline ? new Date(o.pickup_deadline).toISOString() : new Date(Date.now() + ML_DEFAULT_PICKUP_LEAD_MS).toISOString(),
        payment_inr: Number(o.payment_inr || (o.freight_value ? o.freight_value / 100 : 0)),
      };
    })
    .filter(l => Number.isFinite(l.weight_kg) && l.weight_kg > 0);

  const specs = truckSpecs || {
    max_weight_kg: DEFAULT_TRUCK_MAX_WEIGHT_KG,
    max_length_m: DEFAULT_TRUCK_MAX_LENGTH_M,
    max_width_m: DEFAULT_TRUCK_MAX_WIDTH_M,
    max_height_m: DEFAULT_TRUCK_MAX_HEIGHT_M,
  };

  let recommendations = [];
  let mlUsed = false;

  // Try the FastAPI ML engine first
  if (availableLoads.length > 0) {
    try {
      const result = await matchDeadhead({
        driverDestination: { lat: currentLat, lng: currentLng },
        truckSpecs: specs,
        arrivalTime: new Date().toISOString(),
        availableLoads,
      });
      recommendations = result.recommendations || [];
      mlUsed = true;
    } catch (err) {
      logger.warn('[ML] matchEnRouteLoads: falling back to haversine. Reason: ' + err.message);
    }

  // Haversine fallback — score by distance to pickup
  if (!mlUsed || recommendations.length === 0) {
    recommendations = offers
      .filter(o => o.pickup_lat && o.pickup_lng)
      .map(o => {
        const dtKm = _haversineKm(currentLat, currentLng, Number(o.pickup_lat), Number(o.pickup_lng));
        return {
          load_id: o.id,
          detour_km: dtKm,
          distance_to_pickup_km: dtKm,
          match_score: Math.max(0, 1 - dtKm / maxDetourKm),
          estimated_earnings: Number(o.payment_inr || (o.freight_value ? o.freight_value / 100 : 0)),
          _fallback: true,
        };
      })
      .filter(r => r.detour_km <= maxDetourKm)
      .sort((a, b) => b.match_score - a.match_score);
  }
}

module.exports = new MLService();
