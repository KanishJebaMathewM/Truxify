import axios from 'axios';
import logger from '../../middleware/logger.js';
import { CircuitBreaker } from '../../lib/circuitBreaker.js';
import { admitTrajectory, admitMatchResponse, rawMatch, MAX_MATCH_RESPONSE_BYTES } from './osrmMatchProtocol.js';

export class HmmMapMatcher {
  constructor(options = {}) {
    const base = options.osrmBaseUrl ?? process.env.OSRM_BASE_URL ?? 'https://router.project-osrm.org';
    if (typeof base !== 'string' || !base.trim()) throw new TypeError('OSRM base URL must be a nonempty HTTP URL');
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash) {
      throw new TypeError('OSRM base URL requires HTTP(S) without query or fragment');
    }
    this.osrmBaseUrl = base.trim().replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 4000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60000) {
      throw new RangeError('timeoutMs must be an integer in [1,60000]');
    }
    this.breaker = new CircuitBreaker('gps-map-matching', {
      failureThreshold: 5, resetTimeoutMs: 20000, requestTimeoutMs: this.timeoutMs,
    });
  }

  /** Own the complete trajectory before async HTTP, then admit the complete response. */
  async matchTrajectory(points) {
    const owned = admitTrajectory(points);
    if (owned.length < 2) return owned.map((point) => rawMatch(point, 'insufficient_points'));
    const coordinateString = owned.map((point) => `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`).join(';');
    const radiuses = owned.map((point) => Math.max(15, Math.min(50, Math.round(point.accuracy ?? 25)))).join(';');
    const params = { geometries: 'geojson', overview: 'full', radiuses, steps: false, annotations: false };
    if (owned[0].timestamp !== undefined) {
      params.timestamps = owned.map((point) => Math.floor(point.timestamp / 1000)).join(';');
    }
    try {
      return await this.breaker.execute(async ({ signal }) => {
        const response = await axios.get(`${this.osrmBaseUrl}/match/v1/driving/${coordinateString}`, {
          timeout: this.timeoutMs, signal, params, maxContentLength: MAX_MATCH_RESPONSE_BYTES,
        });
        // A malformed provider protocol is a failed admitted request, not success.
        return admitMatchResponse(response.data, owned);
      });
    } catch (error) {
      logger.warn({ err: error.message }, '[HmmMapMatcher] Matching unavailable; retaining unobserved input coordinates');
      return owned.map((point) => rawMatch(point, 'provider_unavailable'));
    }
  }
}

export default HmmMapMatcher;
