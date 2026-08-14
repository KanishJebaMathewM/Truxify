import logger from '../middleware/logger.js';

const RUSH_HOUR_START_AM = 7;
const RUSH_HOUR_END_AM = 10;
const RUSH_HOUR_START_PM = 16;
const RUSH_HOUR_END_PM = 19;
const MIN_SURGE_MULTIPLIER = 1.2;
const MAX_SURGE_MULTIPLIER = 2.5;
const SURGE_PEAK_AMPLITUDE = 1.3;

/**
 * Calculates a live traffic multiplier for a given pickup location.
 * Combines TOMTOM/Google Maps real-time traffic data with a sinusoidal rush-hour
 * surge overlay (7-10 AM and 4-7 PM UTC). Falls back to rush-hour only if no API key
 * is configured or the request fails.
 *
 * @param {number} pickupLat - Pickup latitude
 * @param {number} pickupLng - Pickup longitude
 * @returns {Promise<number>} Traffic multiplier (1.0 to 2.5), or 1.0 on error
 */
export async function getLiveTrafficMultiplier(pickupLat, pickupLng) {
  try {
    if (pickupLat == null || pickupLng == null) {
      return 1.0;
    }
    if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) {
      return 1.0;
    }

    const apiKey = process.env.TOMTOM_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

    let multiplier;

    if (apiKey) {
      if (process.env.TOMTOM_API_KEY) {
        const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?key=${process.env.TOMTOM_API_KEY}&point=${pickupLat},${pickupLng}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`TomTom API error: ${response.status}`);
        const data = await response.json();
        const speedDiff = data.flowSegmentData?.speedDiffPercent || 0;
        multiplier = Math.min(MAX_SURGE_MULTIPLIER, Math.max(1.0, 1.0 + Math.max(0, -speedDiff / 100)));
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
    } else {
      // No traffic API key -- fall back to a deterministic rush-hour multiplier.
      multiplier = getRushHourMultiplier(new Date());
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

/**
 * Returns a rush-hour surge multiplier based on the hour of day (UTC).
 * Peaks at MIN_SURGE_MULTIPLIER + SURGE_PEAK_AMPLITUDE during the center of
 * the rush-hour windows (morning 7-10 UTC, evening 16-19 UTC).
 *
 * @param {Date} date - Date/time to evaluate
 * @returns {number} Surge multiplier between MIN_SURGE_MULTIPLIER and MAX_SURGE_MULTIPLIER
 */
function getRushHourMultiplier(date) {
  const hour = date.getUTCHours();
  const isMorningRush = hour >= RUSH_HOUR_START_AM && hour < RUSH_HOUR_END_AM;
  const isEveningRush = hour >= RUSH_HOUR_START_PM && hour < RUSH_HOUR_END_PM;
  if (!isMorningRush && !isEveningRush) {
    return 1.0;
  }
  const peakHour = isMorningRush
    ? (hour - RUSH_HOUR_START_AM) / (RUSH_HOUR_END_AM - RUSH_HOUR_START_AM)
    : (hour - RUSH_HOUR_START_PM) / (RUSH_HOUR_END_PM - RUSH_HOUR_START_PM);
  const surge = MIN_SURGE_MULTIPLIER + SURGE_PEAK_AMPLITUDE * Math.sin(peakHour * Math.PI);
  return Number(Math.min(MAX_SURGE_MULTIPLIER, Math.max(MIN_SURGE_MULTIPLIER, surge)).toFixed(2));
}
