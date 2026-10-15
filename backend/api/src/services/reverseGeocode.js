import logger from '../middleware/logger.js';

export async function reverseGeocode(lat, lng) {
  // Input validation guards (as established in related fixes)
  if (lat === null || lat === undefined || !Number.isFinite(Number(lat))) {
    throw new TypeError(`Invalid latitude provided: must be a finite number, received ${lat}`);
  }
  if (lng === null || lng === undefined || !Number.isFinite(Number(lng))) {
    throw new TypeError(`Invalid longitude provided: must be a finite number, received ${lng}`);
  }

  const pLat = Number(lat);
  const pLng = Number(lng);

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${pLat}&lon=${pLng}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Truxify-Logistics-Platform/1.0',
      },
    });

    // Check if the response status is not OK (e.g., 404, 503, 500)
    if (!response.ok) {
      logger.warn({ status: response.status, lat: pLat, lng: pLng }, 'Geocoding upstream API returned non-OK status');
      return { 
        error: 'Geocoding failed', 
        status: response.status 
      };
    }

    const data = await response.json();
    return data;
  } catch (err) {
    logger.error({ error: err.message, lat: pLat, lng: pLng }, 'Exception occurred during reverse geocoding');
    throw err;
  }
}
