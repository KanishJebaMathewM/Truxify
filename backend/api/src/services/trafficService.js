import logger from '../middleware/logger.js';

const RUSH_HOUR_START_AM = 7;
const RUSH_HOUR_END_AM = 10;
const RUSH_HOUR_START_PM = 16;
const RUSH_HOUR_END_PM = 19;
const MIN_SURGE_MULTIPLIER = 1.2;
const MAX_SURGE_MULTIPLIER = 2.5;
const SURGE_PEAK_AMPLITUDE = 1.3;

export async function getLiveTrafficMultiplier(pickupLat, pickupLng) {
  try {
    if (!pickupLat || !pickupLng) {
      return 1.0;
    }

    const apiKey = process.env.TOMTOM_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      logger.warn('[TrafficService] No traffic API key configured -- returning 1.0 (no surge)');
      return 1.0;
    }

    let multiplier;
    if (process.env.TOMTOM_API_KEY) {
      const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?key=${process.env.TOMTOM_API_KEY}&point=${pickupLat},${pickupLng}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`TomTom API error: ${response.status}`);
      const data = await response.json();
      const speedDiff = data.flowSegmentData?.speedDiffPercent || 0;
      multiplier = Math.min(MAX_SURGE_MULTIPLIER, Math.max(1.0, 1.0 + Math.max(0, speedDiff / 100)));
    } else {
      const origin = `${pickupLat},${pickupLng}`;
      const destination = `${pickupLat + 0.01},${pickupLng + 0.01}`;
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destination}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Google API error: ${response.status}`);
      const data = await response.json();
      const duration = data.rows?.[0]?.elements?.[0]?.duration_in_traffic?.value;
      const normalDuration = data.rows?.[0]?.elements?.[0]?.duration?.value;
      if (duration && normalDuration && normalDuration > 0) {
        multiplier = Math.min(MAX_SURGE_MULTIPLIER, Math.max(1.0, duration / normalDuration));
      } else {
        multiplier = 1.0;
      }
    }

    if (multiplier > 1.0) {
      logger.info(`[TrafficService] Live traffic data at ${pickupLat},${pickupLng}: x${Number(multiplier).toFixed(2)}`);
    }
    return Number(multiplier.toFixed(2));
  } catch (error) {
    logger.error({ err: error }, '[TrafficService] Error fetching live traffic data -- returning 1.0');
    return 1.0;
  }
}
