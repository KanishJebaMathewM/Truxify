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

    const response = await fetch(url, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
    });

    return handleResponse(response);
}