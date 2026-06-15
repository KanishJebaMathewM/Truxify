const DEFAULT_ML_ENGINE_URL = 'http://localhost:8001';

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
export async function predictDemand(features) {
  const baseUrl = process.env.ML_ENGINE_URL || DEFAULT_ML_ENGINE_URL;
  const url = `${baseUrl}/predict/demand`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(features),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ML Engine prediction request failed: ${response.statusText} (${text})`);
  }

  return response.json();
}
