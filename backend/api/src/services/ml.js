import logger from '../middleware/logger.js';
import { validatePricePrediction, convertToPaisa, RejectionReason } from '../lib/predictionValidator.js';
import { LRUCache } from '../utils/cache.js';

const demandCache = new LRUCache(100, 15 * 60 * 1000);
const priceCache = new LRUCache(100, 15 * 60 * 1000);

// Single source of truth for ML engine base URL
const DEFAULT_ML_ENGINE_URL = 'http://localhost:8001';

// Startup validation
if (!process.env.ML_API_KEY) {
    logger.warn('[ML] WARNING: ML_API_KEY is not set. All ML API endpoints will return 503. Set ML_API_KEY in your environment.');
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
    return headers;
}

/**
 * Utility: handle ML engine responses consistently
 */
async function handleResponse(response) {
    const text = await response.text();

    if (response.status === 401 || response.status === 403) {
        throw new Error(`[ML] Authentication failed (${response.status}): ${text}`);
    }
    if (!response.ok) {
        throw new Error(`[ML] Request failed (${response.status}): ${text}`);
    }

    try {
        return JSON.parse(text);
    } catch (err) {
        throw new Error(`[ML] Invalid JSON response from ML engine: ${err.message}`, { cause: err });
    }
}

/**
 * Utility: resolve base URL for ML engine
 */
function getBaseUrl() {
    return (
        process.env.ML_ENGINE_URL ||
        process.env.ML_SERVICE_URL ||
        DEFAULT_ML_ENGINE_URL
    );
}

/**
 * Predicts ride/truck demand
 * @param {object} features
 * @returns {Promise<object>}
 */
export async function predictDemand(features = {}) {
  guardMlApiKey();
  const cacheKey = JSON.stringify(features);
  const cached = demandCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const url = `${getBaseUrl()}/predict/demand`;

  const response = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(features),
      signal: AbortSignal.timeout(5000),
  });

  const result = await handleResponse(response);
  demandCache.set(cacheKey, result);
  return result;
}

/**
 * Predicts freight price.
 *
 * Returns the validated ML response with `estimatedPricePaisa` (paisa integer)
 * and `estimatedPriceInr` (INR float) added. Throws on any validation failure
 * so callers can transparently fall back to deterministic pricing.
 *
 * @param {object} params
 * @returns {Promise<{estimated_price: number, currency: string, estimatedPricePaisa: number}>}
 * @throws {Error} on HTTP failure, timeout, or prediction validation failure
 */
export async function predictPrice({
    distanceKm,
    cargoWeightKg,
    truckType = 'medium_truck',
    routeOrigin = '',
    routeDestination = '',
} = {}) {
  guardMlApiKey();
  
  const cacheKey = JSON.stringify({ distanceKm, cargoWeightKg, truckType, routeOrigin, routeDestination });
  const cached = priceCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const url = `${getBaseUrl()}/predict/price`;

  const payload = {
      distance_km: distanceKm,
      cargo_weight_kg: cargoWeightKg,
      truck_type: truckType,
      route_origin: routeOrigin,
      route_destination: routeDestination,
  };

  const response = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
  });

  const raw = await handleResponse(response);

  const validated = validatePricePrediction(raw);
  if (!validated.ok) {
      logger.warn({
          reason: validated.reason,
          detail: validated.detail,
          response_keys: raw && typeof raw === 'object' ? Object.keys(raw) : typeof raw,
      }, '[ML] Price prediction rejected by validator');
      throw new Error(`[ML] Invalid prediction: ${validated.reason} — ${validated.detail}`);
  }

  logger.debug({
      estimated_price_inr: validated.validated.estimated_price,
      confidence: validated.validated.confidence,
  }, '[ML] Price prediction validated successfully');

  const result = {
      ...validated.validated,
      estimatedPricePaisa: convertToPaisa(validated.validated.estimated_price),
      estimatedPriceInr: validated.validated.estimated_price,
  };
  priceCache.set(cacheKey, result);
  return result;
}

/**
 * Predicts estimated time of arrival for a route.
 *
 * @param {object} params
 * @param {number} params.routeDistance  - Route distance in km (must be > 0)
 * @param {number} params.timeOfDay      - Hour of the day (0-23)
 * @param {number} params.dayOfWeek      - Day of week (0=Sunday, 6=Saturday)
 * @param {string} params.routeType      - Route type ("highway" or "city")
 * @param {number} params.historicalSpeed - Historical average speed in km/h (must be > 0)
 * @returns {Promise<{eta_minutes: number, confidence_interval: {lower: number, upper: number}}>}
 * @throws {Error} if ML_API_KEY is missing, HTTP fails, or response is invalid
 */
export async function predictEta({
  routeDistance,
  timeOfDay,
  dayOfWeek,
  routeType,
  historicalSpeed,
}) {
  guardMlApiKey();
  const url = `${getBaseUrl()}/predict/eta`;

  const payload = {
    route_distance: routeDistance,
    time_of_day: timeOfDay,
    day_of_week: dayOfWeek,
    route_type: routeType,
    historical_speed: historicalSpeed,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  });

  const result = await handleResponse(response);

  if (
    result == null ||
    typeof result.eta_minutes !== 'number' ||
    !isFinite(result.eta_minutes)
  ) {
    throw new Error('[ML] Invalid ETA prediction: missing or non-finite eta_minutes');
  }

  return {
    eta_minutes: result.eta_minutes,
    confidence_interval: result.confidence_interval ?? { lower: 0, upper: 0 },
  };
}

/**
 * Matches shipments for bilateral load consolidation.
 *
 * @param {object} params
 * @param {Array}  params.loads   - Array of load objects with origin/dest lat/lng, dimensions, deadline
 * @param {Array}  params.drivers - Array of driver objects with current location, capacity, rating
 * @returns {Promise<{assignments: Array, unmatched_loads: Array, unmatched_drivers: Array}>}
 * @throws {Error} if ML_API_KEY is missing or HTTP fails
 */
export async function matchBilateral({ loads, drivers }) {
  guardMlApiKey();
  const url = `${getBaseUrl()}/match/bilateral`;

  const payload = { loads, drivers };

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });

  return handleResponse(response);
}

/**
 * Predicts driver profit for a given route using ML model.
 *
 * @param {object} params
 * @param {number} params.routeDistanceKm  - Total route distance in km (must be > 0)
 * @param {number} params.fuelPricePerLitre - Current fuel price in INR/L (must be > 0)
 * @param {number} params.tollEstimateInr  - Estimated toll cost in INR (must be >= 0)
 * @param {number} params.truckMileageKmL  - Truck fuel efficiency in km/L (must be > 0)
 * @param {number} params.cargoWeightKg    - Cargo weight in kg (must be > 0)
 * @param {number} params.tripDurationHours - Estimated trip duration in hours (must be > 0)
 * @returns {Promise<{predicted_profit: number, confidence_interval: {lower: number, upper: number}}>}
 * @throws {Error} if ML_API_KEY is missing, HTTP fails, or response is invalid
 */
export async function predictDriverProfit({
  routeDistanceKm,
  fuelPricePerLitre,
  tollEstimateInr,
  truckMileageKmL,
  cargoWeightKg,
  tripDurationHours,
}) {
  guardMlApiKey();
  const url = `${getBaseUrl()}/predict/driver-profit`;

  const payload = {
    route_distance: routeDistanceKm,
    fuel_price: fuelPricePerLitre,
    toll_estimate: tollEstimateInr,
    truck_mileage: truckMileageKmL,
    cargo_weight: cargoWeightKg,
    trip_duration: tripDurationHours,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  });

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
    signal: AbortSignal.timeout(10000),
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
    signal: AbortSignal.timeout(5000),
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
    signal: AbortSignal.timeout(5000),
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
    signal: AbortSignal.timeout(5000),
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
    signal: AbortSignal.timeout(10000),
  });
  return handleResponse(response);
}

/**
 * Optimises a mid-trip route based on real-time conditions.
 * @param {object} routeData - { current_location, destination, fuel_level, hours_driven }
 * @returns {Promise<{adjustments: Array, fuel_saving: number}>}
 */
export async function optimiseMidTrip(routeData) {
  const baseUrl = process.env.ML_ENGINE_URL || DEFAULT_ML_ENGINE_URL;
  const url = `${baseUrl}/optimise/mid-trip`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(routeData),
    signal: AbortSignal.timeout(5000),
  });
  return handleResponse(response);
}

/**
 * Triggers retraining of the demand prediction model.
 * @param {boolean} [force=false] - Force retrain even if model is current
 * @returns {Promise<{status: string, model_version: string}>}
 */
export async function trainDemandModel(force = false) {
  const baseUrl = process.env.ML_ENGINE_URL || DEFAULT_ML_ENGINE_URL;
  const url = `${baseUrl}/train/demand`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ force }),
    signal: AbortSignal.timeout(300000),
  });
  return handleResponse(response);
}

/**
 * Triggers retraining of the price prediction model.
 * @param {boolean} [force=false] - Force retrain even if model is current
 * @returns {Promise<{status: string, model_version: string}>}
 */
export async function trainPriceModel(force = false) {
  const baseUrl = process.env.ML_ENGINE_URL || DEFAULT_ML_ENGINE_URL;
  const url = `${baseUrl}/train/price`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ force }),
    signal: AbortSignal.timeout(300000),
  });
  return handleResponse(response);
}

/**
 * Lists all available ML models and their versions.
 * @returns {Promise<{models: Array}>}
 */
export async function listModels() {
  const baseUrl = process.env.ML_ENGINE_URL || DEFAULT_ML_ENGINE_URL;
  const url = `${baseUrl}/models`;
  const response = await fetch(url, {
    method: 'GET',
    headers: getHeaders(),
    signal: AbortSignal.timeout(5000),
  });
  return handleResponse(response);
}

export const __testing = {
  demandCache,
  priceCache
};
