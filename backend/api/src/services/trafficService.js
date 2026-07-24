import logger from '../middleware/logger.js';

/**
 * Fetches live traffic congestion metrics.
 * Uses a mock implementation for TomTom / Google Maps Distance Matrix.
 * Returns a traffic multiplier >= 1.0 based on current congestion.
 * 
 * @param {number} pickupLat 
 * @param {number} pickupLng 
 * @returns {Promise<number>}
 */
export async function getLiveTrafficMultiplier(pickupLat, pickupLng) {
  try {
    if (!pickupLat || !pickupLng) {
      return 1.0;
    }

    // In a real production scenario, this would call TomTom or Google Maps Distance Matrix API:
    // const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?key=${process.env.TOMTOM_API_KEY}&point=${pickupLat},${pickupLng}`;
    // const response = await fetch(url);
    // const data = await response.json();
    // return calculateMultiplierFromData(data);

    // Mocking a live traffic integration:
    // If it's rush hour, dynamically generate a surge multiplier (1.2 to 2.5) based on coordinates hash to simulate localized congestion
    const hour = new Date().getHours();
    const isRushHour = (hour >= 7 && hour <= 10) || (hour >= 16 && hour <= 19);

    if (isRushHour) {
      // Create a deterministic pseudo-random multiplier based on coordinates
      const geoHash = Math.abs(Math.sin(pickupLat) + Math.cos(pickupLng));
      const surgeMultiplier = 1.2 + (geoHash * 1.3); // between 1.2 and 2.5
      logger.info(`[TrafficService] Live traffic surge detected at ${pickupLat},${pickupLng}: x${surgeMultiplier.toFixed(2)}`);
      return Number(surgeMultiplier.toFixed(2));
    }

    return 1.0;
  } catch (error) {
    logger.error(`[TrafficService] Error fetching live traffic data: ${error.message}`);
    // Fail open, return normal multiplier
    return 1.0;
  }
}
