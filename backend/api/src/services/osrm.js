import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';
import CircuitBreaker from 'opossum';
import { measureExecution } from '../core/performanceMetrics.js';

export const osrmBreaker = new CircuitBreaker(async (url, options) => {
  const response = await fetch(url, options);
  if (response.status >= 500) {
    throw new Error(`[OSRM] Request failed (${response.status})`);
  }
  return response;
}, {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000
});


const RECOVERABLE_ERRORS = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'FETCH_ERR'];

async function withRetry(fn, options = {}) {
  const { retries = 2, baseDelay = 300, label = 'operation' } = options;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < retries && RECOVERABLE_ERRORS.some(e => err.code === e || err.message?.includes(e))) {
        const delay = baseDelay * Math.pow(2, attempt);
        logger.warn(`[osrm] ${label} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

const DEFAULT_OSRM_BASE_URL = 'https://router.project-osrm.org';
const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const CACHE_TTL_SECONDS = 86400;
const ROUTE_CACHE_TTL_SECONDS = 30;

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

function buildCacheKey({ pickupLat, pickupLng, dropLat, dropLng }) {
  const r = (n) => Number(n.toFixed(6));
  return `osrm:route:v2:${r(pickupLat)}:${r(pickupLng)}:${r(dropLat)}:${r(dropLng)}`;
}

export async function getRouteEstimate({ pickupLat, pickupLng, dropLat, dropLng } = {}) {
  return measureExecution('OSRMService.getRouteEstimate', async () => {
  if (
    !Number.isFinite(pickupLat) || !Number.isFinite(pickupLng) ||
    !Number.isFinite(dropLat) || !Number.isFinite(dropLng)
  ) {
    return null;
  }

  const cacheKey = buildCacheKey({ pickupLat, pickupLng, dropLat, dropLng });

  if (redisClient) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (err) {
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
      const response = await osrmBreaker.fire(buildRouteUrl({ pickupLat, pickupLng, dropLat, dropLng }), {
        signal: controller.signal,
      });

      if (!response.ok) {
        clearTimeout(timeout);
        if (response.status >= 500 && attempt < maxRetries - 1) {
          logger.warn({ status: response.status, attempt: attempt + 1, maxRetries }, 'Server error. Retrying...');
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
        if (err.code === 'EOPENBREAKER' || err.message?.includes('Breaker is open')) {
          logger.warn('[OSRM] Circuit is open. Falling back instantly.');
          return null; // Return null so caller knows to use straight-line fallback
        }
        logger.warn({ attempt: attempt + 1, maxRetries, errMessage: err.message, delayMs }, 'Fetch error. Retrying...');
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        logger.error({ maxRetries, errMessage: err.message }, 'Fetch error after all retries:');
        return null;
      }
    }
  }

  return null;
  });
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
  const r = (n) => Number(n.toFixed(6));
  return `osrm:geometry:v2:${r(originLat)}:${r(originLng)}:${r(destLat)}:${r(destLng)}`;
}

export async function getRouteGeometry({ originLat, originLng, destLat, destLng } = {}) {
  return measureExecution('OSRMService.getRouteGeometry', async () => {
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
    const response = await osrmBreaker.fire(
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
    if (err.message?.includes('Circuit open')) return null;
    return null;
  } finally {
    clearTimeout(timeout);
  }
  });
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
