import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const NOMINATIM_TIMEOUT_MS = 5000;

function getTimeoutMs() {
  const configured = Number(process.env.NOMINATIM_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : NOMINATIM_TIMEOUT_MS;
}

/**
 * Reverse geocodes a latitude and longitude to a human-readable address
 * using the OpenStreetMap Nominatim API. Implements aggressive Redis caching.
 *
 * @param {number|string} lat - Latitude
 * @param {number|string} lon - Longitude
 * @returns {Promise<string|null>} Formatted location string or null if failed
 */
export async function reverseGeocode(lat, lon) {
  if (lat == null || lon == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lon))) return null;

  // Round coordinates to ~100m precision (3 decimal places) to maximize cache hits
  const roundedLat = Number(lat).toFixed(3);
  const roundedLon = Number(lon).toFixed(3);
  const cacheKey = `geocode:${roundedLat},${roundedLon}`;

  try {
    // 1. Check Redis Cache
    if (redisClient) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // 2. Fetch from OpenStreetMap Nominatim
    // Note: Nominatim requires a valid User-Agent to avoid being blocked
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${roundedLat}&lon=${roundedLon}&zoom=14`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Truxify-Node-Backend/1.0',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(getTimeoutMs()),
    });

    if (!response.ok) {
      logger.error({ status: response.status }, '[ReverseGeocode] Nominatim API error');
      return null;
    }

    const data = await response.json();
    let formattedAddress = null;

    if (data && data.address) {
      // Build a clean, readable location string (e.g., "NH-48, Jaipur")
      const { road, suburb, city, town, village, state } = data.address;
      
      const localArea = road || suburb || village;
      const mainArea = city || town || state;

      if (localArea && mainArea) {
        formattedAddress = `${localArea}, ${mainArea}`;
      } else if (mainArea) {
        formattedAddress = mainArea;
      } else if (data.display_name) {
        // Fallback to the full display string, truncated if too long
        formattedAddress = data.display_name.split(',').slice(0, 2).join(',');
      }
    }

    // 3. Save to Redis Cache if valid
    if (formattedAddress && redisClient) {
      await redisClient.set(cacheKey, formattedAddress, 'EX', CACHE_TTL_SECONDS);
    }

    return formattedAddress;
  } catch (err) {
    logger.error({ err, lat, lon }, '[ReverseGeocode] Error reverse geocoding coordinates');
    return null;
  }
}
