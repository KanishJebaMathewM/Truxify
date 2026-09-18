import axios from 'axios';

const OSRM_BASE_URL = process.env.OSRM_BASE_URL || 'http://localhost:5000';
const OSRM_TIMEOUT = parseInt(process.env.OSRM_TIMEOUT || '5000', 10);

let axiosClient = axios;

export const setAxiosClientForTesting = (mockAxios) => {
    axiosClient = mockAxios;
};

export const resetAxiosClient = () => {
    axiosClient = axios;
};

/**
 * Built-in resilient Exponential Backoff executor for network retries.
 */
export class ExponentialBackoff {
    constructor(options = {}) {
        this.maxRetries = options.maxRetries || 3;
        this.baseDelay = options.baseDelay || 100;
        this.maxDelay = options.maxDelay || 2000;
        this.factor = options.factor || 2;
        this.jitter = options.jitter ?? false;
    }

    async execute(fn) {
        let lastError;
        let delay = this.baseDelay;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                if (attempt === this.maxRetries) break;

                let currentDelay = delay;
                if (this.jitter) {
                    currentDelay += Math.random() * 0.3 * delay;
                }
                await new Promise((resolve) => setTimeout(resolve, currentDelay));
                delay = Math.min(delay * this.factor, this.maxDelay);
            }
        }
        throw new Error(`Routing request failed after ${this.maxRetries} attempts: ${lastError.message}`);
    }
}

/**
 * Circuit Breaker pattern to protect against cascading OSRM cluster outages.
 */
export class CircuitBreaker {
    constructor(options = {}) {
        this.name = options.name || 'osrm-routing';
        this.failureThreshold = options.failureThreshold || 3;
        this.resetTimeout = options.resetTimeout || 5000;
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.lastFailureTime = null;
    }

    async execute(fn) {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailureTime > this.resetTimeout) {
                this.state = 'HALF-OPEN';
            } else {
                throw new Error(`Circuit breaker '${this.name}' is OPEN. OSRM service degraded.`);
            }
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    onSuccess() {
        this.failureCount = 0;
        this.state = 'CLOSED';
    }

    onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
        }
    }

    getState() {
        return this.state;
    }
}

export const osrmBackoff = new ExponentialBackoff();
export const osrmCircuitBreaker = new CircuitBreaker();

/**
 * Validates geographic coordinates within valid spherical limits.
 * @param {number|string} lon
 * @param {number|string} lat
 * @param {string} label
 */
export const validateCoordinate = (lon, lat, label = 'coordinate') => {
    const numLon = typeof lon === 'number' ? lon : parseFloat(lon);
    const numLat = typeof lat === 'number' ? lat : parseFloat(lat);

    if (!Number.isFinite(numLon) || !Number.isFinite(numLat)) {
        throw new Error(`Invalid ${label}: Longitude and latitude must be finite numbers`);
    }
    if (numLat < -90 || numLat > 90) {
        throw new Error(`Invalid ${label} latitude: ${numLat}. Latitude must be between -90 and 90 degrees`);
    }
    if (numLon < -180 || numLon > 180) {
        throw new Error(`Invalid ${label} longitude: ${numLon}. Longitude must be between -180 and 180 degrees`);
    }

    return { lon: numLon, lat: numLat };
};

/**
 * Calculates straight-line spherical distance between two points using the Haversine formula.
 * @param {number} lon1
 * @param {number} lat1
 * @param {number} lon2
 * @param {number} lat2
 * @returns {number} Distance in meters
 */
export const calculateStraightLineDistance = (lon1, lat1, lon2, lat2) => {
    const p1 = validateCoordinate(lon1, lat1, 'start');
    const p2 = validateCoordinate(lon2, lat2, 'end');

    const R = 6371e3; // Earth radius in meters
    const phi1 = (p1.lat * Math.PI) / 180;
    const phi2 = (p2.lat * Math.PI) / 180;
    const deltaPhi = ((p2.lat - p1.lat) * Math.PI) / 180;
    const deltaLambda = ((p2.lon - p1.lon) * Math.PI) / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) *
        Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(R * c);
};

/**
 * Estimates duration in seconds from distance using an assumed commercial truck highway speed.
 * @param {number} distanceMeters
 * @param {number} averageSpeedKmh Default 40 km/h for congested freight corridors
 * @returns {number} Estimated duration in seconds
 */
export const estimateDurationFromDistance = (distanceMeters, averageSpeedKmh = 40) => {
    if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
        throw new Error('Distance must be a non-negative finite number');
    }
    const distanceKm = distanceMeters / 1000;
    const durationHours = distanceKm / averageSpeedKmh;
    return Math.round(durationHours * 3600);
};

/**
 * Constructs the canonical OSRM driving route URL.
 * @param {number} startLon
 * @param {number} startLat
 * @param {number} endLon
 * @param {number} endLat
 * @returns {string}
 */
export const buildOSRMUrl = (startLon, startLat, endLon, endLat) => {
    const p1 = validateCoordinate(startLon, startLat, 'origin');
    const p2 = validateCoordinate(endLon, endLat, 'destination');
    return `${OSRM_BASE_URL}/route/v1/driving/${p1.lon},${p1.lat};${p2.lon},${p2.lat}?overview=full&geometries=geojson`;
};

/**
 * Direct invocation to query OSRM daemon without circuit breaker wrapper.
 * @param {number} startLon
 * @param {number} startLat
 * @param {number} endLon
 * @param {number} endLat
 * @returns {Promise<Object>}
 */
export const fetchRouteFromOSRM = async (startLon, startLat, endLon, endLat) => {
    const url = buildOSRMUrl(startLon, startLat, endLon, endLat);

    const response = await axiosClient.get(url, {
        timeout: OSRM_TIMEOUT,
    });

    if (!response || !response.data || response.data.code !== 'Ok') {
        const errCode = response?.data?.code || 'NO_RESPONSE';
        throw new Error(`OSRM returned error code: ${errCode}`);
    }

    if (!Array.isArray(response.data.routes) || response.data.routes.length === 0) {
        throw new Error('OSRM returned empty routes array');
    }

    return response.data.routes[0];
};

/**
 * Queries OSRM with retry backoff and circuit breaker, falling back gracefully to Haversine straight-line estimation.
 * @param {number} startLon
 * @param {number} startLat
 * @param {number} endLon
 * @param {number} endLat
 * @returns {Promise<Object>}
 */
export const getRouteWithResilience = async (startLon, startLat, endLon, endLat) => {
    const p1 = validateCoordinate(startLon, startLat, 'start');
    const p2 = validateCoordinate(endLon, endLat, 'end');

    try {
        return await osrmCircuitBreaker.execute(async () => {
            return await osrmBackoff.execute(async () => {
                return await fetchRouteFromOSRM(p1.lon, p1.lat, p2.lon, p2.lat);
            });
        });
    } catch (error) {
        const distance = calculateStraightLineDistance(p1.lon, p1.lat, p2.lon, p2.lat);
        const duration = estimateDurationFromDistance(distance);

        return {
            fallback: true,
            distance,
            duration,
            geometry: {
                type: 'LineString',
                coordinates: [
                    [p1.lon, p1.lat],
                    [p2.lon, p2.lat]
                ]
            },
            message: 'OSRM service degraded. Returning straight-line estimation.',
            error: error.message
        };
    }
};

export default {
    getRouteWithResilience,
    fetchRouteFromOSRM,
    calculateStraightLineDistance,
    estimateDurationFromDistance,
    validateCoordinate,
    buildOSRMUrl,
    setAxiosClientForTesting,
    resetAxiosClient,
    osrmBackoff,
    osrmCircuitBreaker,
    ExponentialBackoff,
    CircuitBreaker
};
