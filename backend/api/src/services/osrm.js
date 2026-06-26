import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';

const DEFAULT_OSRM_BASE_URL = 'https://router.project-osrm.org';
const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const CACHE_TTL_SECONDS = 86400;
const ROUTE_CACHE_TTL_SECONDS = 30;
const MAX_RETRIES = 1;
const RETRY_DELAYS_MS = [500, 1000]; // exponential backoff

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildRouteUrl({ pickupLat, pickupLng, dropLat, dropLng }) {
  const baseUrl = process.env.OSRM_BASE_URL || DEFAULT_OSRM_BASE_URL;
  const url = new URL('/route/v1/driving/', baseUrl);
  url.pathname += `${pickupLng},${pickupLat};${dropLng},${dropLat}`;
  url.searchParams.set('overview', 'false');
  url.searchParams.set('alternatives', 'false');
  url.searchParams.set('steps', 'false');
  return url;
}

function buildCacheKey({ pickupLat, pickupLng, dropLat, dropLng}){
  const r = (n) => Number(n.toFixed(4));
  return `osrm:route:${r(pickupLat)}:${r(pickupLng)}:${r(dropLat)}:${r(dropLng)}`;
}

export async function getRouteEstimate({ pickupLat, pickupLng, dropLat, dropLng } = {}) {
  if (
    !Number.isFinite(pickupLat) || !Number.isFinite(pickupLng) ||
    !Number.isFinite(dropLat) || !Number.isFinite(dropLng)
  ) {
    return null;
  }

  const cacheKey = buildCacheKey({ pickupLat, pickupLng, dropLat, dropLng });

  if(redisClient){
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) return JSON.parse(cached);

    } catch(err){
      logger.error('[osrm] Redis get error:', err.message);
    }
  }

  const timeoutMs = parsePositiveNumber(process.env.OSRM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const maxRetries = parsePositiveNumber(process.env.OSRM_MAX_RETRIES, DEFAULT_MAX_RETRIES);
  const baseDelayMs = parsePositiveNumber(process.env.OSRM_RETRY_BASE_DELAY_MS, DEFAULT_RETRY_BASE_DELAY_MS);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(buildRouteUrl({ pickupLat, pickupLng, dropLat, dropLng }), {
        signal: controller.signal,
      });

      if (!response.ok) {
        clearTimeout(timeout);
        if (response.status >= 500 && attempt < maxRetries - 1) {
          logger.warn('[osrm] Server error %d (attempt %d/%d). Retrying...', response.status, attempt + 1, maxRetries);
          await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
          continue;
        }
        return null;
      }

      const payload = await response.json();
      const route = Array.isArray(payload?.routes) ? payload.routes[0] : null;
      if (!route || !Number.isFinite(route.distance) || route.distance < 0) {
        clearTimeout(timeout);
        return null;
      }

      const result = {
        distanceKm: route.distance / 1000,
        durationSeconds: Number.isFinite(route.duration) ? route.duration : null,
      };

      if (redisClient) {
        try {
          await redisClient.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);
        } catch (err) {
          logger.error('[osrm] Redis set error:', err.message);
        }
      }

      clearTimeout(timeout);
      return result;

    } catch (err) {
      clearTimeout(timeout);
      if (attempt < maxRetries - 1) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        logger.warn('[osrm] Fetch error (attempt %d/%d): %s. Retrying in %d ms...', attempt + 1, maxRetries, err.message, delayMs);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        logger.error('[osrm] Fetch error after all %d retries: %s', maxRetries, err.message);
        return null;
      }
    }
  }

  return null;
}

function buildGeometryUrl({ originLat, originLng, destLat, destLng }) {
  const baseUrl = process.env.OSRM_BASE_URL || DEFAULT_OSRM_BASE_URL;
  const url = new URL('/route/v1/driving/', baseUrl);
  url.pathname += `${originLng},${originLat};${destLng},${destLat}`;
  url.searchParams.set('overview', 'full');
  url.searchParams.set('geometries', 'geojson');
  url.searchParams.set('alternatives', 'false');
  url.searchParams.set('steps', 'false');
  return url;
}

function buildGeometryCacheKey({ originLat, originLng, destLat, destLng }) {
  const r = (n) => Number(n.toFixed(4));
  return `osrm:geometry:${r(originLat)}:${r(originLng)}:${r(destLat)}:${r(destLng)}`;
}

export async function getRouteGeometry({ originLat, originLng, destLat, destLng } = {}) {
  if (
    !Number.isFinite(originLat) || !Number.isFinite(originLng) ||
    !Number.isFinite(destLat) || !Number.isFinite(destLng)
  ) {
    return null;
  }

  const cacheKey = buildGeometryCacheKey({ originLat, originLng, destLat, destLng });

  if (redisClient) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (err) {
      logger.error('[osrm] Redis get error (geometry):', err.message);
    }
  }

  const timeoutMs = parsePositiveNumber(process.env.OSRM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      buildGeometryUrl({ originLat, originLng, destLat, destLng }),
      { signal: controller.signal },
    );
    if (!response.ok) return null;

    const payload = await response.json();
    const route = Array.isArray(payload?.routes) ? payload.routes[0] : null;
    const coordinates = route?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return null;
    }

    const feature = {
      type: 'Feature',
      properties: {
        distanceKm: Number.isFinite(route.distance) ? route.distance / 1000 : null,
        durationSeconds: Number.isFinite(route.duration) ? route.duration : null,
      },
      geometry: {
        type: 'LineString',
        coordinates,
      },
    };

    if (redisClient) {
      try {
        await redisClient.set(cacheKey, JSON.stringify(feature), 'EX', ROUTE_CACHE_TTL_SECONDS);
      } catch (err) {
        logger.error('[osrm] Redis set error (geometry):', err.message);
      }
    }
    return feature;

  } catch (err) {
    logger.error('[osrm] Fetch error (geometry):', err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function buildStraightLineGeometry({ originLat, originLng, destLat, destLng } = {}) {
  if (
    !Number.isFinite(originLat) || !Number.isFinite(originLng) ||
    !Number.isFinite(destLat) || !Number.isFinite(destLng)
  ) {
    return null;
  }

  return {
    type: 'Feature',
    properties: { fallback: true },
    geometry: {
      type: 'LineString',
      coordinates: [
        [originLng, originLat],
        [destLng, destLat],
      ],
    },
  };
}

export const __testing = {
  buildRouteUrl,
  buildCacheKey,
  buildGeometryUrl,
  buildGeometryCacheKey,
  DEFAULT_OSRM_BASE_URL,
  DEFAULT_TIMEOUT_MS,
};