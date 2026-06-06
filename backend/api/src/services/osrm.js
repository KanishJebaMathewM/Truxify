const DEFAULT_OSRM_BASE_URL = 'https://router.project-osrm.org';
const DEFAULT_TIMEOUT_MS = 1500;

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

export async function getRouteEstimate({ pickupLat, pickupLng, dropLat, dropLng } = {}) {
  if (
    !Number.isFinite(pickupLat) || !Number.isFinite(pickupLng) ||
    !Number.isFinite(dropLat) || !Number.isFinite(dropLng)
  ) {
    return null;
  }

  const timeoutMs = parsePositiveNumber(process.env.OSRM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildRouteUrl({ pickupLat, pickupLng, dropLat, dropLng }), {
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const payload = await response.json();
    const route = Array.isArray(payload?.routes) ? payload.routes[0] : null;
    if (!route || !Number.isFinite(route.distance) || route.distance < 0) {
      return null;
    }

    return {
      distanceKm: route.distance / 1000,
      durationSeconds: Number.isFinite(route.duration) ? route.duration : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export const __testing = { buildRouteUrl, DEFAULT_OSRM_BASE_URL, DEFAULT_TIMEOUT_MS };
