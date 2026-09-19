import axios from 'axios';
import logger from '../../middleware/logger.js';
import { CircuitBreaker } from '../../lib/circuitBreaker.js';

export class HmmMapMatcher {
  /**
   * @param {object} [options={}]
   * @param {string} [options.osrmBaseUrl] - OSRM service URL
   * @param {number} [options.timeoutMs=4000] - Request timeout
   */
  constructor(options = {}) {
    this.osrmBaseUrl = options.osrmBaseUrl || process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';
    this.timeoutMs = options.timeoutMs || 4000;

    this.breaker = new CircuitBreaker({
      failureThreshold: 5,
      cooldownPeriod: 20000,
    });
  }

  /**
   * Snaps a sequence of GPS coordinates to the road network using OSRM HMM Map Matching API.
   * 
   * @param {Array<{lat: number, lng: number, timestamp?: number, accuracy?: number}>} points
   * @returns {Promise<Array<{lat: number, lng: number, confidence: number, roadName?: string}>>}
   */
  async matchTrajectory(points) {
    if (!Array.isArray(points) || points.length < 2) {
      return points.map((p) => ({ lat: p.lat, lng: p.lng, confidence: 1.0 }));
    }

    // Format coordinates: lng,lat;lng,lat...
    const coordString = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const radiuses = points.map((p) => Math.max(15, Math.min(50, Math.round(p.accuracy || 25)))).join(';');
    const timestamps = points.map((p) => Math.floor((p.timestamp || Date.now()) / 1000)).join(';');

    const url = `${this.osrmBaseUrl}/match/v1/driving/${coordString}`;

    try {
      const response = await this.breaker.execute(async () => {
        return axios.get(url, {
          timeout: this.timeoutMs,
          params: {
            geometries: 'geojson',
            overview: 'full',
            radiuses,
            timestamps,
            steps: false,
            annotations: false,
          },
        });
      });

      const data = response?.data;
      if (data?.code === 'Ok' && data.matchings && data.matchings.length > 0) {
        const tracepoints = data.tracepoints || [];
        const matchedPoints = [];

        for (let i = 0; i < points.length; i++) {
          const tp = tracepoints[i];
          if (tp && tp.location) {
            matchedPoints.push({
              lat: Number(tp.location[1].toFixed(7)),
              lng: Number(tp.location[0].toFixed(7)),
              confidence: Number((data.matchings[0].confidence || 0.9).toFixed(3)),
              roadName: tp.name || '',
            });
          } else {
            // Unmatched point: fallback to input coordinate
            matchedPoints.push({
              lat: points[i].lat,
              lng: points[i].lng,
              confidence: 0.5,
            });
          }
        }

        return matchedPoints;
      }

      logger.warn({ code: data?.code }, '[HmmMapMatcher] OSRM Match returned non-Ok code; using raw smoothed points');
      return points.map((p) => ({ lat: p.lat, lng: p.lng, confidence: 0.7 }));
    } catch (err) {
      logger.warn({ err: err.message }, '[HmmMapMatcher] Map matching network call failed; using local fallback');
      return points.map((p) => ({ lat: p.lat, lng: p.lng, confidence: 0.6 }));
    }
  }
}

export default HmmMapMatcher;
