import axios from 'axios';
import logger from '../../middleware/logger.js';
import { CircuitBreaker } from '../../lib/circuitBreaker.js';

export class CorridorService {
  /**
   * @param {object} [options={}]
   * @param {string} [options.osrmBaseUrl]
   * @param {number} [options.defaultBufferMeters=25000] - 25km buffer default
   */
  constructor(options = {}) {
    this.osrmBaseUrl = options.osrmBaseUrl || process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';
    this.defaultBufferMeters = options.defaultBufferMeters || 25000;
    this.breaker = new CircuitBreaker({
      failureThreshold: 5,
      cooldownPeriod: 20000,
    });
  }

  /**
   * Fetches the detailed OSRM route geometry between origin and destination.
   * 
   * @param {object} origin - { lat, lng }
   * @param {object} destination - { lat, lng }
   * @returns {Promise<{coordinates: Array<[number, number]>, distanceKm: number, durationMinutes: number}>}
   */
  async getRouteGeometry(origin, destination) {
    const url = `${this.osrmBaseUrl}/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;

    try {
      const response = await this.breaker.execute(async () => {
        return axios.get(url, {
          timeout: 4000,
          params: {
            geometries: 'geojson',
            overview: 'full',
            steps: false,
          },
        });
      });

      const route = response?.data?.routes?.[0];
      if (route && route.geometry) {
        return {
          coordinates: route.geometry.coordinates, // [[lng, lat], ...]
          distanceKm: Number((route.distance / 1000).toFixed(2)),
          durationMinutes: Number((route.duration / 60).toFixed(1)),
        };
      }

      throw new Error('No route found in OSRM response');
    } catch (err) {
      logger.warn({ err: err.message }, '[CorridorService] OSRM route lookup failed; constructing straight line approximation');
      return {
        coordinates: [
          [origin.lng, origin.lat],
          [destination.lng, destination.lat],
        ],
        distanceKm: 0,
        durationMinutes: 0,
      };
    }
  }

  /**
   * Generates an elastic corridor bounding box and GeoJSON buffer along a route.
   * 
   * @param {object} origin - { lat, lng }
   * @param {object} destination - { lat, lng }
   * @param {number} [bufferMeters] - Buffer radius in meters (default 25km)
   * @returns {Promise<object>} Corridor definition with bounding box and GeoJSON
   */
  async generateCorridor(origin, destination, bufferMeters = null) {
    const radiusMeters = bufferMeters || this.defaultBufferMeters;
    const route = await this.getRouteGeometry(origin, destination);

    const coords = route.coordinates;
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    for (const [lng, lat] of coords) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }

    // Convert buffer meters to approximate degree offset (1 deg lat ~ 111,320m)
    const latBufferDeg = radiusMeters / 111320;
    const avgLat = (minLat + maxLat) / 2;
    const lngBufferDeg = radiusMeters / (111320 * Math.cos((avgLat * Math.PI) / 180));

    const boundingBox = {
      minLng: Number((minLng - lngBufferDeg).toFixed(6)),
      maxLng: Number((maxLng + lngBufferDeg).toFixed(6)),
      minLat: Number((minLat - latBufferDeg).toFixed(6)),
      maxLat: Number((maxLat + latBufferDeg).toFixed(6)),
    };

    const routeLineStringGeoJson = {
      type: 'LineString',
      coordinates: coords,
    };

    return {
      origin,
      destination,
      bufferMeters: radiusMeters,
      directDistanceKm: route.distanceKm,
      directDurationMinutes: route.durationMinutes,
      boundingBox,
      routeLineStringGeoJson,
      generatedAt: new Date().toISOString(),
    };
  }
}

export default CorridorService;
