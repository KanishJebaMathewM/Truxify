import logger from '../middleware/logger.js';

const RUSH_HOUR_START_AM = 7;
const RUSH_HOUR_END_AM = 10;
const RUSH_HOUR_START_PM = 16;
const RUSH_HOUR_END_PM = 19;
const MIN_SURGE_MULTIPLIER = 1.2;
const MAX_SURGE_MULTIPLIER = 2.5;
const SURGE_PEAK_AMPLITUDE = 1.3;

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
    // if (!response.ok) throw new Error("Request failed");
    // const data = await response.json();
    // return calculateMultiplierFromData(data);

    // Mocking a live traffic integration:
    // If it's rush hour, dynamically generate a surge multiplier (1.2 to 2.5) based on coordinates hash to simulate localized congestion
    const hour = new Date().getHours();
    const isRushHour =
      (hour >= RUSH_HOUR_START_AM && hour <= RUSH_HOUR_END_AM) ||
      (hour >= RUSH_HOUR_START_PM && hour <= RUSH_HOUR_END_PM);

    if (isRushHour) {
      // sin(x) + cos(y) ranges over [-2, 2], so after Math.abs it's [0, 2] — normalize to [0, 1] before scaling
      const geoHash = Math.abs(Math.sin(pickupLat) + Math.cos(pickupLng)) / 2;
      const surgeMultiplier = Math.min(MAX_SURGE_MULTIPLIER, Math.max(MIN_SURGE_MULTIPLIER, MIN_SURGE_MULTIPLIER + (geoHash * SURGE_PEAK_AMPLITUDE))); // clamped to 1.2–2.5
      logger.info(`[TrafficService] Live traffic surge detected at ${pickupLat},${pickupLng}: x${surgeMultiplier.toFixed(2)}`);
      return Number(surgeMultiplier.toFixed(2));
    }

    return 1.0;
  } catch (error) {
    logger.error({ err: error }, '[TrafficService] Error fetching live traffic data');
    // Fail open, return normal multiplier
    return 1.0;
  }
}
