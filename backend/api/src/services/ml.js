// Default URLs: localhost works for host-to-container, ML_ENGINE_URL env var
// overrides for Docker Compose container-to-container communication.
const DEFAULT_ML_ENGINE_URL = 'http://localhost:8001';
const DEFAULT_ML_SERVICE_URL = 'http://localhost:8001';

// Startup validation: warn if ML_API_KEY is not set
if (!process.env.ML_API_KEY) {
  // Use console.warn here since logger may not be initialized at module load time
  console.warn('[ML] WARNING: ML_API_KEY is not set. ML features will be unavailable.');
}

/**
 * Predicts ride/truck demand by calling the FastAPI ML engine service.
 *
 * @param {object} features
 * @param {number} features.hour
 * @param {number} features.day_of_week
 * @param {number} features.temperature
 * @param {number} features.precipitation
 * @param {number} features.historical_volume
 * @param {number} features.nearby_drivers
 * @returns {Promise<object>} response from the ML engine
 */
function getHeaders() {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (process.env.ML_API_KEY) {
    headers['X-API-Key'] = process.env.ML_API_KEY;
  }
  return headers;
}

async function handleResponse(response) {
  if (response.status === 401 || response.status === 403) {
    const text = await response.text();
    throw new Error(`ML Engine authentication failed: ${response.status} — check ML_API_KEY configuration`);
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ML Engine request failed: ${response.statusText} (${text})`);
  }
  return response.json();
}

export async function predictDemand(features) {
  const baseUrl = process.env.ML_ENGINE_URL || DEFAULT_ML_ENGINE_URL;
  const url = `${baseUrl}/predict/demand`;

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(features),
    signal: AbortSignal.timeout(5000),
  });

  return handleResponse(response);
}

/**
 * Predicts freight price by calling the FastAPI ML engine service.
 *
 * @param {object} params
 * @param {number} params.distanceKm - Route distance in kilometres
 * @param {number} params.cargoWeightKg - Cargo weight in kilograms
 * @param {string} [params.truckType] - Type of truck
 * @param {string} [params.routeOrigin] - Origin location
 * @param {string} [params.routeDestination] - Destination location
 * @returns {Promise<{estimated_price: number, currency: string}>} price prediction
 */
export async function predictPrice({ distanceKm, cargoWeightKg, truckType, routeOrigin, routeDestination } = {}) {
  const baseUrl = process.env.ML_SERVICE_URL || process.env.ML_ENGINE_URL || DEFAULT_ML_SERVICE_URL;
  const url = `${baseUrl}/predict`;

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      distance_km: distanceKm,
      cargo_weight_kg: cargoWeightKg,
      truck_type: truckType || 'medium_truck',
      route_origin: routeOrigin || '',
      route_destination: routeDestination || '',
    }),
    signal: AbortSignal.timeout(5000),
  });

  return handleResponse(response);
}
