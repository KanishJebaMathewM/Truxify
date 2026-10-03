import { fetchAddressFromCoords, getReverseGeocode } from '../../lib/reverseGeocode.js';
import logger from '../../middleware/logger.js';

// NEW: Enterprise Validation Utility
export function validateCoordinates(lat, lon) {
  if (lat == null || lon == null) return false;
  const nLat = Number(lat);
  const nLon = Number(lon);
  return !Number.isNaN(nLat) && !Number.isNaN(nLon) && nLat >= -90 && nLat <= 90 && nLon >= -180 && nLon <= 180;
}

// NEW: Microservice Health Check Endpoint
export function getProviderHealth() {
  return { status: 'OK', service: 'GeocodeProvider', timestamp: new Date().toISOString() };
}

export async function resolveDriverLocation(lat, lon) {
  const startTime = Date.now();
  
  // NEW: Early rejection using our new utility
  if (!validateCoordinates(lat, lon)) {
    logger.warn({ lat, lon }, '[GeocodeProvider] Invalid coordinates rejected early');
    return { error: 'Invalid coordinates provided', latency: Date.now() - startTime };
  }

  try {
    const address = await fetchAddressFromCoords(lat, lon);
    const latency = Date.now() - startTime;

    if (!address) {
      logger.warn({ lat, lon, latency }, '[GeocodeProvider] Address resolution returned null');
      return { error: 'Location resolution failed', latency };
    }
    
    return { 
      success: true, 
      formattedAddress: address,
      latency,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    logger.error(`[GeocodeProvider] Error resolving location: ${err?.message ?? String(err)}`);
    return { error: 'Location resolution failed', latency: Date.now() - startTime };
  }
}

export async function resolveMultipleLocations(coordsList) {
  if (!Array.isArray(coordsList) || coordsList.length === 0) {
    return { success: true, results: [], errors: 0 };
  }

  const results = await Promise.all(
    coordsList.map(async (coords) => {
      if (!coords || typeof coords.lat === 'undefined' || typeof coords.lon === 'undefined') {
        return { error: 'Invalid coordinates' };
      }
      return resolveDriverLocation(coords.lat, coords.lon);
    })
  );

  const successful = results.filter(r => r.success);
  return {
    success: true,
    total: coordsList.length,
    successfulCount: successful.length,
    errors: coordsList.length - successful.length,
    results
  };
}

export const geocodeProvider = { 
  resolveDriverLocation, 
  resolveMultipleLocations, 
  getReverseGeocode,
  validateCoordinates,
  getProviderHealth
};
