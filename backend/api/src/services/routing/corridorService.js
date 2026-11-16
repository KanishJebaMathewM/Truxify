import axios from 'axios';
import logger from '../../middleware/logger.js';
import { CircuitBreaker } from '../../lib/circuitBreaker.js';
import { geographic, bufferRadius, admitRoute, corridorEnvelope, MAX_ROUTE_RESPONSE_BYTES } from './corridorObservation.js';

function fallback(start, end, reason) {
  return { coordinates: [[start.lng, start.lat], [end.lng, end.lat]], distanceKm: 0, durationMinutes: 0,
    source: 'straight_line', routeObserved: false, reason };
}

export class CorridorService {
  #base;
  #buffer;
  #timeout;
  constructor(options = {}) {
    const base = options.osrmBaseUrl ?? process.env.OSRM_BASE_URL ?? 'https://router.project-osrm.org';
    if (typeof base !== 'string' || !base.trim()) throw new TypeError('OSRM base URL must be nonempty');
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash) throw new TypeError('OSRM base URL must use HTTP(S) without query/fragment');
    this.#base = base.trim().replace(/\/+$/, '');
    this.#buffer = bufferRadius(options.defaultBufferMeters ?? 25000);
    this.#timeout = options.timeoutMs ?? 4000;
    if (!Number.isSafeInteger(this.#timeout) || this.#timeout < 1 || this.#timeout > 60000) throw new RangeError('timeout must be an integer in [1,60000]');
    this.breaker = new CircuitBreaker('routing-corridor', { failureThreshold: 5, resetTimeoutMs: 20000, requestTimeoutMs: this.#timeout });
  }
  get osrmBaseUrl() { return this.#base; }
  get defaultBufferMeters() { return this.#buffer; }

  async getRouteGeometry(origin, destination) {
    const start = geographic(origin); const end = geographic(destination);
    const path = [start, end].map(point => `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`).join(';');
    try {
      return await this.breaker.execute(async ({ signal }) => {
        const response = await axios.get(`${this.#base}/route/v1/driving/${path}`, {
          timeout: this.#timeout, signal, maxContentLength: MAX_ROUTE_RESPONSE_BYTES,
          params: { geometries: 'geojson', overview: 'full', steps: false, alternatives: false },
        });
        return admitRoute(response.data) ?? fallback(start, end, 'no_route');
      });
    } catch (error) {
      logger.warn({ err: error.message }, '[CorridorService] Road route unobserved; retaining owned straight-line fallback');
      return fallback(start, end, 'provider_unavailable');
    }
  }

  async generateCorridor(origin, destination, bufferMeters = null) {
    const start = geographic(origin); const end = geographic(destination);
    const radius = bufferRadius(bufferMeters ?? this.#buffer);
    const route = await this.getRouteGeometry(start, end);
    const envelope = corridorEnvelope(route.coordinates, radius);
    return { origin: { ...start }, destination: { ...end }, bufferMeters: radius,
      directDistanceKm: route.distanceKm, directDurationMinutes: route.durationMinutes,
      boundingBox: envelope.boundingBox, longitudeMode: envelope.longitudeMode,
      routeSource: route.source, routeObserved: route.routeObserved, routeReason: route.reason,
      routeLineStringGeoJson: { type: 'LineString', coordinates: route.coordinates.map(point => [...point]) },
      generatedAt: new Date().toISOString() };
  }
}
export default CorridorService;
