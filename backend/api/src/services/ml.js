// Single source of truth for ML engine base URL
const DEFAULT_ML_ENGINE_URL = 'http://localhost:8001';

// Startup validation
if (!process.env.ML_API_KEY) {
    console.warn('[ML] WARNING: ML_API_KEY is not set. ML features will be unavailable.');
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
    } catch {
        throw new Error('[ML] Invalid JSON response from ML engine');
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
    const url = `${getBaseUrl()}/predict/demand`;

    const response = await fetch(url, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(features),
        signal: AbortSignal.timeout(5000),
    });

    return handleResponse(response);
}

/**
 * Predicts freight price
 * @param {object} params
 * @returns {Promise<{estimated_price: number, currency: string}>}
 */
export async function predictPrice({
    distanceKm,
    cargoWeightKg,
    truckType = 'medium_truck',
    routeOrigin = '',
    routeDestination = '',
} = {}) {
    const url = `${getBaseUrl()}/predict`;

    const payload = {
        distance_km: distanceKm,
        cargo_weight_kg: cargoWeightKg,
        truck_type: truckType,
        route_origin: routeOrigin,
        route_destination: routeDestination,
    };

  return handleResponse(response);
}

/**
 * Predicts estimated time of arrival for a route.
 * @param {string} origin - Origin coordinates or address
 * @param {string} destination - Destination coordinates or address
 * @param {object} [traffic] - Traffic factor data
 * @param {object} [weather] - Weather condition data
 * @returns {Promise<{estimated_minutes: number, confidence: number}>}
 */
export async function predictEta(origin, destination, traffic = {}, weather = {}) {
  const baseUrl = process.env.ML_ENGINE_URL || DEFAULT_ML_ENGINE_URL;
  const url = `${baseUrl}/predict/eta`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ origin, destination, traffic, weather }),
    signal: AbortSignal.timeout(5000),
  });
  return handleResponse(response);
}

/**
 * Matches shipments for bilateral load consolidation.
 * @param {object} shipmentData - { weight, volume, origin, destination, pickup_time, delivery_time }
 * @returns {Promise<{matches: Array}>}
 */
export async function matchBilateral(shipmentData) {
  const baseUrl = process.env.ML_ENGINE_URL || DEFAULT_ML_ENGINE_URL;
  const url = `${baseUrl}/match/bilateral`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(shipmentData),
    signal: AbortSignal.timeout(5000),
  });
  return handleResponse(response);
}

/**
 * Predicts driver profit for a given route.
 * @param {string} driverId
 * @param {object} route - { distance_km, origin, destination, tolls }
 * @returns {Promise<{estimated_profit: number, confidence: number}>}
 */
export async function predictDriverProfit(driverId, route) {
  const baseUrl = process.env.ML_ENGINE_URL || DEFAULT_ML_ENGINE_URL;
  const url = `${baseUrl}/predict/driver-profit`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ driver_id: driverId, ...route }),
    signal: AbortSignal.timeout(5000),
  });
  return handleResponse(response);
}

/**
 * Optimises packing of items into bins.
 * @param {Array<{id: string, w: number, h: number, d: number, weight: number}>} items
 * @returns {Promise<{bins: Array, efficiency: number}>}
 */
export async function optimisePacking(items) {
  const baseUrl = process.env.ML_ENGINE_URL || DEFAULT_ML_ENGINE_URL;
  const url = `${baseUrl}/optimise/packing`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ items }),
    signal: AbortSignal.timeout(10000),
  });
  return handleResponse(response);
}

/**
 * Recommends available loads for a truck in a region.
 * @param {string} truckId
 * @param {string} region
 * @returns {Promise<{loads: Array, total_revenue: number}>}
 */
export async function recommendLoads(truckId, region) {
  const baseUrl = process.env.ML_ENGINE_URL || DEFAULT_ML_ENGINE_URL;
  const url = `${baseUrl}/recommend/loads`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ truck_id: truckId, region }),
    signal: AbortSignal.timeout(5000),
  });
  return handleResponse(response);
}

/**
 * Recommends suitable trucks for a given load.
 * @param {string} loadId
 * @returns {Promise<{trucks: Array, average_price: number}>}
 */
export async function recommendTrucks(loadId) {
  const baseUrl = process.env.ML_ENGINE_URL || DEFAULT_ML_ENGINE_URL;
  const url = `${baseUrl}/recommend/trucks`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ load_id: loadId }),
    signal: AbortSignal.timeout(5000),
  });
  return handleResponse(response);
}

/**
 * Computes a trust score for a driver or customer entity.
 * @param {string} entityId
 * @returns {Promise<{trust_score: number, factors: object}>}
 */
export async function scoreTrust(entityId) {
  const baseUrl = process.env.ML_ENGINE_URL || DEFAULT_ML_ENGINE_URL;
  const url = `${baseUrl}/score/trust`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ entity_id: entityId }),
    signal: AbortSignal.timeout(5000),
  });
  return handleResponse(response);
}

/**
 * Finds deadhead (return-trip) loads for a truck to avoid empty backhauls.
 * @param {string} truckId
 * @returns {Promise<{loads: Array, revenue: number}>}
 */
export async function matchDeadhead(truckId) {
  const baseUrl = process.env.ML_ENGINE_URL || DEFAULT_ML_ENGINE_URL;
  const url = `${baseUrl}/match/deadhead`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ truck_id: truckId }),
    signal: AbortSignal.timeout(5000),
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
