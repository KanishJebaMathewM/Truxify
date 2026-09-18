import logger from '../middleware/logger.js';
import { redisClient } from '../config/db.js';

const RUSH_HOUR_START_AM = 7;
const RUSH_HOUR_END_AM = 10;
const RUSH_HOUR_START_PM = 16;
const RUSH_HOUR_END_PM = 19;
const MIN_SURGE_MULTIPLIER = 1.2;
const MAX_SURGE_MULTIPLIER = 2.5;
const SURGE_PEAK_AMPLITUDE = 1.3;
const CACHE_TTL = 300; // 5 minutes caching for live traffic

/**
 * Calculates a live traffic multiplier for a given pickup location.
 * Combines TOMTOM/Google Maps real-time traffic data with a sinusoidal rush-hour
 * surge overlay (7-10 AM and 4-7 PM IST). Falls back to rush-hour only if no API key
 * is configured or the request fails.
 *
 * @param {number} pickupLat - Pickup latitude
 * @param {number} pickupLng - Pickup longitude
 * @returns {Promise<number>} Traffic multiplier (1.0 to 2.5), or 1.0 on error
 */
export async function getLiveTrafficMultiplier(pickupLat, pickupLng) {
  try {
    if (pickupLat == null || pickupLng == null || !Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) {
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
      // No traffic API key -- return baseline 1.0 (no mock surge applied to pricing).
      multiplier = 1.0;
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
 * Returns a rush-hour surge multiplier based on the hour of day in IST
 * (UTC+5:30, matching the platform's target market).
 * Peaks at MIN_SURGE_MULTIPLIER + SURGE_PEAK_AMPLITUDE during the center of
 * the rush-hour windows (morning 7-10 IST, evening 16-19 IST).
 *
 * @param {Date} date - Date/time to evaluate
 * @returns {number} Surge multiplier between MIN_SURGE_MULTIPLIER and MAX_SURGE_MULTIPLIER
 */
export function getRushHourMultiplier(date) {
  // Guard against invalid Date objects that produce NaN from getUTCHours.
  if (!date || Number.isNaN(date.getTime())) {
    return 1.0;
  }
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const hour = new Date(date.getTime() + IST_OFFSET_MS).getUTCHours();

  const isMorningRush = hour >= RUSH_HOUR_START_AM && hour < RUSH_HOUR_END_AM;
  const isEveningRush = hour >= RUSH_HOUR_START_PM && hour < RUSH_HOUR_END_PM;
  if (!isMorningRush && !isEveningRush) {
    return 1.0;
  }
  const peakHour = isMorningRush
    ? (hour - RUSH_HOUR_START_AM) / (RUSH_HOUR_END_AM - RUSH_HOUR_START_AM)
    : (hour - RUSH_HOUR_START_PM) / (RUSH_HOUR_END_PM - RUSH_HOUR_START_PM);
  const surge = MIN_SURGE_MULTIPLIER + SURGE_PEAK_AMPLITUDE * Math.sin(peakHour * Math.PI);
  const result = Math.min(MAX_SURGE_MULTIPLIER, Math.max(MIN_SURGE_MULTIPLIER, surge));
  if (!Number.isFinite(result)) {
    return 1.0;
  }
  return Number(result.toFixed(2));
}

/**
 * Enterprise Adapter: Safely fetches live traffic multiplier using configured external providers.
 * Includes explicit null guards, Redis caching, and gracefully falls back to the original
 * getRushHourMultiplier heuristic if APIs fail or keys are missing.
 *
 * @param {number|string} lat - Latitude
 * @param {number|string} lng - Longitude
 * @returns {Promise<number>} - Multiplier between 1.0 and 2.5
 */
export async function getLiveTrafficMultiplierEnterprise(lat, lng) {
  const nLat = Number(lat);
  const nLng = Number(lng);

  // Issue #13581: reject non-finite coordinates (NaN, ±Infinity) before any
  // distance/duration calculation so invalid results never reach responses.
  if (lat == null || lng == null || !Number.isFinite(nLat) || !Number.isFinite(nLng)) {
    logger.warn('[TrafficService] Invalid coordinates provided, returning default multiplier (1.0).');
    return 1.0;
  }

  const cacheKey = `traffic_ent:${nLat.toFixed(3)},${nLng.toFixed(3)}`;
  
  if (redisClient) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) return Number.parseFloat(cached);
    } catch (cacheErr) {
      logger.debug(`[TrafficService] Redis cache read failed: ${cacheErr.message}`);
    }
  }

  // Delegate to the original internal logic to preserve sinusoidal math
  let multiplier = await getLiveTrafficMultiplier(nLat, nLng);

  if (redisClient) {
    try {
      await redisClient.set(cacheKey, multiplier.toFixed(2), 'EX', CACHE_TTL);
    } catch (err) {
      // Ignore cache write errors
    }
  }

  return multiplier;
}

/**
 * Retrieves traffic conditions and multiplier for a specified route.
 * Supports caching via Redis, integrates external provider APIs,
 * and gracefully falls back on failure or invalid inputs.
 *
 * @param {Object} route - Route descriptor with origin/destination or pickup/drop coordinates
 * @param {Object} [options] - Additional options (e.g. skipCache)
 * @returns {Promise<Object>} Traffic details for the route
 */
export async function getTrafficForRoute(route, options = {}) {
  try {
    if (!route || typeof route !== 'object') {
      logger.warn('[TrafficService] Invalid route object provided');
      return {
        success: false,
        multiplier: 1.0,
        congestionLevel: 'unknown',
        delayMinutes: 0,
        error: 'Invalid route descriptor',
      };
    }

    // Extract origin & destination coordinates
    let originLat;
    let originLng;
    let destLat;
    let destLng;

    if (route.origin && route.destination) {
      if (Array.isArray(route.origin) && Array.isArray(route.destination)) {
        [originLat, originLng] = route.origin;
        [destLat, destLng] = route.destination;
      } else if (typeof route.origin === 'object' && typeof route.destination === 'object') {
        originLat = route.origin.lat ?? route.origin.latitude;
        originLng = route.origin.lng ?? route.origin.longitude;
        destLat = route.destination.lat ?? route.destination.latitude;
        destLng = route.destination.lng ?? route.destination.longitude;
      } else if (typeof route.origin === 'string' && typeof route.destination === 'string') {
        const [oLat, oLng] = route.origin.split(',').map(Number);
        const [dLat, dLng] = route.destination.split(',').map(Number);
        originLat = oLat;
        originLng = oLng;
        destLat = dLat;
        destLng = dLng;
      }
    } else {
      originLat = route.pickup_lat ?? route.pickupLat ?? route.startLat ?? route.start_lat;
      originLng = route.pickup_lng ?? route.pickupLng ?? route.startLng ?? route.start_lng;
      destLat = route.drop_lat ?? route.dropLat ?? route.endLat ?? route.end_lat;
      destLng = route.drop_lng ?? route.dropLng ?? route.endLng ?? route.end_lng;
    }

    const nOriginLat = Number(originLat);
    const nOriginLng = Number(originLng);
    const nDestLat = Number(destLat);
    const nDestLng = Number(destLng);

    if (
      !Number.isFinite(nOriginLat) ||
      !Number.isFinite(nOriginLng) ||
      !Number.isFinite(nDestLat) ||
      !Number.isFinite(nDestLng)
    ) {
      logger.warn('[TrafficService] Invalid or missing route coordinates');
      return {
        success: false,
        multiplier: 1.0,
        congestionLevel: 'unknown',
        delayMinutes: 0,
        error: 'Invalid route coordinates',
      };
    }

    const cacheKey = `traffic_route:${nOriginLat.toFixed(3)},${nOriginLng.toFixed(3)}:${nDestLat.toFixed(3)},${nDestLng.toFixed(3)}`;

    // Cache check
    if (redisClient && !options.skipCache) {
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          logger.debug(`[TrafficService] Cache hit for route traffic: ${cacheKey}`);
          return { ...parsed, cached: true };
        }
      } catch (cacheErr) {
        logger.debug(`[TrafficService] Redis route cache read failed: ${cacheErr.message}`);
      }
    }

    // Compute live traffic multiplier across the route
    let multiplier = 1.0;
    let delayMinutes = 0;
    let congestionLevel = 'low';

    const apiKey = process.env.TOMTOM_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

    if (apiKey) {
      if (process.env.TOMTOM_API_KEY) {
        const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?key=${process.env.TOMTOM_API_KEY}&point=${nOriginLat},${nOriginLng}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`TomTom API error: ${response.status}`);
        const data = await response.json();
        const speedDiff = data.flowSegmentData?.speedDiffPercent || 0;
        multiplier = Math.min(MAX_SURGE_MULTIPLIER, Math.max(1.0, 1.0 + Math.max(0, -speedDiff / 100)));
        delayMinutes = Math.max(0, Math.round((data.flowSegmentData?.currentDelaySec || 0) / 60));
      } else {
        const origin = `${nOriginLat},${nOriginLng}`;
        const destination = `${nDestLat},${nDestLng}`;
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destination}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Google API error: ${response.status}`);
        const data = await response.json();
        const durationInTraffic = data.rows?.[0]?.elements?.[0]?.duration_in_traffic?.value;
        const normalDuration = data.rows?.[0]?.elements?.[0]?.duration?.value;

        if (durationInTraffic && normalDuration && normalDuration > 0) {
          multiplier = Math.min(MAX_SURGE_MULTIPLIER, Math.max(1.0, durationInTraffic / normalDuration));
          delayMinutes = Math.max(0, Math.round((durationInTraffic - normalDuration) / 60));
        } else {
          multiplier = 1.0;
        }
      }
    } else {
      multiplier = getRushHourMultiplier(new Date());
    }

    multiplier = Number(multiplier.toFixed(2));
    if (multiplier >= 1.8) {
      congestionLevel = 'heavy';
    } else if (multiplier >= 1.3) {
      congestionLevel = 'moderate';
    } else {
      congestionLevel = 'low';
    }

    const result = {
      success: true,
      multiplier,
      congestionLevel,
      delayMinutes,
      origin: { lat: nOriginLat, lng: nOriginLng },
      destination: { lat: nDestLat, lng: nDestLng },
    };

    if (redisClient && !options.skipCache) {
      try {
        await redisClient.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
      } catch (err) {
        // Ignore cache write error
      }
    }

    return result;
  } catch (error) {
    logger.error({ err: error }, '[TrafficService] Error fetching route traffic -- falling back to default heuristic');
    const fallbackMultiplier = getRushHourMultiplier(new Date());
    return {
      success: true,
      multiplier: fallbackMultiplier,
      congestionLevel: fallbackMultiplier >= 1.3 ? 'moderate' : 'low',
      delayMinutes: 0,
      fallback: true,
    };
  }
}

// Export a unified enterprise module interface for testing and external consumers
export const trafficService = { 
  getLiveTrafficMultiplier: getLiveTrafficMultiplierEnterprise, 
  getRushHourMultiplier,
  getTrafficForRoute,
};

export default trafficService;
