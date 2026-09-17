import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const NOMINATIM_TIMEOUT_MS = 5000;
const DEFAULT_RETRY_AFTER_MS = 60000;
const MAX_RETRY_AFTER_MS = 60000;

/**
 * Returns the Nominatim HTTP timeout in milliseconds.
 * Reads NOMINATIM_TIMEOUT_MS from environment or falls back to NOMINATIM_TIMEOUT_MS constant.
 *
 * @returns {number} Timeout in milliseconds (minimum 1)
 */
export function getTimeoutMs() {
  const configured = Number(process.env.NOMINATIM_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : NOMINATIM_TIMEOUT_MS;
}

/**
 * Parses a Retry-After header value into a millisecond delay.
 *
 * Supports both forms defined by RFC 9110:
 *   - delay-seconds: e.g. "120"
 *   - HTTP-date:     e.g. "Wed, 21 Oct 2025 07:28:00 GMT"
 *
 * Falls back to DEFAULT_RETRY_AFTER_MS when the value is missing,
 * invalid, non-positive, or already in the past.
 *
 * @param {string|null|undefined} retryAfter
 * @param {number} [now=Date.now()] - current time in ms (injectable for tests)
 * @returns {number} Delay in milliseconds (always finite and > 0)
 */
export function parseRetryAfterMs(retryAfter, now = Date.now()) {
  if (!retryAfter || typeof retryAfter !== 'string') {
    return DEFAULT_RETRY_AFTER_MS;
  }

  const value = retryAfter.trim();

  // Form 1: delay-seconds (integer number of seconds).
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    const ms = seconds * 1000;
    return Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_RETRY_AFTER_MS;
  }

  // Form 2: HTTP-date.
  const retryAt = Date.parse(value);
  if (!Number.isNaN(retryAt)) {
    const ms = retryAt - now;
    return Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_RETRY_AFTER_MS;
  }

  return DEFAULT_RETRY_AFTER_MS;
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
  // === Issue #14036: Explicit early null-guard without Number coercion ===
  if (lat == null || lon == null) {
    logger.debug('[ReverseGeocode] Aborted early: Coordinates contain null or undefined values.');
    return null;
  }

  const numLat = Number(lat);
  const numLon = Number(lon);
  if (!Number.isFinite(numLat) || !Number.isFinite(numLon)) return null;
  if (numLat < -90 || numLat > 90 || numLon < -180 || numLon > 180) return null;

  // Round coordinates to ~100m precision (3 decimal places) to maximize cache hits
  const roundedLat = numLat.toFixed(3);
  const roundedLon = numLon.toFixed(3);
  const cacheKey = `geocode:${roundedLat},${roundedLon}`;

  try {
    if (redisClient) {
      const cached = await redisClient.get(cacheKey);
      if (cached) return cached;
    }

    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${roundedLat}&lon=${roundedLon}&zoom=14`;
    const requestHeaders = {
      'User-Agent': 'Truxify-Node-Backend/1.0',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    let response = await fetch(url, {
      headers: requestHeaders,
      signal: AbortSignal.timeout(getTimeoutMs()),
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const waitMs = Math.min(parseRetryAfterMs(retryAfter), MAX_RETRY_AFTER_MS);
      logger.warn(
        { waitMs, lat: roundedLat, lon: roundedLon },
        '[ReverseGeocode] Rate-limited, retrying after Retry-After delay'
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      response = await fetch(url, {
        headers: requestHeaders,
        signal: AbortSignal.timeout(getTimeoutMs()),
      });
    }

    if (!response.ok) {
      logger.error({ status: response.status }, '[ReverseGeocode] Nominatim API error');
      return null;
    }

    const data = await response.json();
    let formattedAddress = null;

    if (data && data.address) {
      const { road, suburb, city, town, village, state } = data.address;

      const localArea = road || suburb || village;
      const mainArea = city || town || state;

      if (localArea && mainArea) {
        formattedAddress = `${localArea}, ${mainArea}`;
      } else if (mainArea) {
        formattedAddress = mainArea;
      } else if (data.display_name) {
        formattedAddress = data.display_name.split(',').slice(0, 2).join(',');
      }
    }

    if (formattedAddress && redisClient) {
      await redisClient.set(cacheKey, formattedAddress, 'EX', CACHE_TTL_SECONDS);
    }

    return formattedAddress;
  } catch (err) {
    logger.error({ err, lat, lon }, '[ReverseGeocode] Error reverse geocoding coordinates');
    return null;
  }
}

// Volume Expansion: Enterprise integration aliases for reverseGeocode
export async function getReverseGeocode(lat, lon) {
  return reverseGeocode(lat, lon);
}
export async function fetchAddressFromCoords(lat, lon) {
  return reverseGeocode(lat, lon);
}
export async function reverseGeocodePoint(lat, lon) {
  return reverseGeocode(lat, lon);
}

const MIN = 1, MAX = 12, DEF = 6;
export function clampGeohashPrecision(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEF;
  if (n < MIN) return MIN;
  if (n > MAX) return MAX;
  return Math.floor(n);
}