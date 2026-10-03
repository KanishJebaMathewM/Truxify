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

/**
 * Computes an N x N distance and duration matrix using spherical Haversine geometry with freight tortuosity factor.
 * @param {Array<[number, number]>} coordinates Array of [lon, lat] pairs
 * @param {Object} options Configuration options
 * @returns {Object} Matrix result with distances (meters) and durations (seconds)
 */
export const calculateHaversineDistanceMatrix = (coordinates, options = {}) => {
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        throw new Error('Coordinates must be an array of at least 2 coordinate pairs [lon, lat]');
    }

    const maxPoints = options.maxPoints || 50;
    if (coordinates.length > maxPoints) {
        throw new Error(`Exceeded maximum allowed matrix points (${maxPoints}). Received: ${coordinates.length}`);
    }

    const tortuosityFactor = Number.isFinite(options.tortuosityFactor) && options.tortuosityFactor >= 1.0
        ? options.tortuosityFactor
        : 1.25; // Default freight road network curvature factor

    const averageSpeedKmh = Number.isFinite(options.averageSpeedKmh) && options.averageSpeedKmh > 0
        ? options.averageSpeedKmh
        : 45; // Default commercial freight corridor speed

    const validatedPoints = coordinates.map((c, index) => {
        if (!Array.isArray(c) || c.length < 2) {
            throw new Error(`Coordinate at index ${index} must be an array [lon, lat]`);
        }
        return validateCoordinate(c[0], c[1], `point[${index}]`);
    });

    const n = validatedPoints.length;
    const distances = Array.from({ length: n }, () => new Float64Array(n));
    const durations = Array.from({ length: n }, () => new Float64Array(n));

    for (let i = 0; i < n; i++) {
        distances[i][i] = 0;
        durations[i][i] = 0;
        for (let j = i + 1; j < n; j++) {
            const rawMeters = calculateStraightLineDistance(
                validatedPoints[i].lon,
                validatedPoints[i].lat,
                validatedPoints[j].lon,
                validatedPoints[j].lat
            );
            const roadMeters = Math.round(rawMeters * tortuosityFactor);
            const durationSec = estimateDurationFromDistance(roadMeters, averageSpeedKmh);

            distances[i][j] = roadMeters;
            distances[j][i] = roadMeters;
            durations[i][j] = durationSec;
            durations[j][i] = durationSec;
        }
    }

    return {
        distances: distances.map(row => Array.from(row)),
        durations: durations.map(row => Array.from(row)),
        sources: validatedPoints.map(p => ({ location: [p.lon, p.lat] })),
        destinations: validatedPoints.map(p => ({ location: [p.lon, p.lat] })),
        tortuosityFactor,
        averageSpeedKmh
    };
};

/**
 * Resilient N x N distance matrix resolution with circuit breaker and Haversine fallback.
 * @param {Array<[number, number]>} coordinates
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const getDistanceMatrixWithResilience = async (coordinates, options = {}) => {
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        throw new Error('Coordinates must be an array of at least 2 coordinate pairs [lon, lat]');
    }

    const maxPoints = options.maxPoints || 50;
    if (coordinates.length > maxPoints) {
        throw new Error(`Exceeded maximum allowed matrix points (${maxPoints}). Received: ${coordinates.length}`);
    }

    // Validate coordinates first
    const validatedPoints = coordinates.map((c, index) => {
        if (!Array.isArray(c) || c.length < 2) {
            throw new Error(`Coordinate at index ${index} must be an array [lon, lat]`);
        }
        return validateCoordinate(c[0], c[1], `point[${index}]`);
    });

    try {
        return await osrmCircuitBreaker.execute(async () => {
            return await osrmBackoff.execute(async () => {
                const formattedCoords = validatedPoints.map(p => `${p.lon},${p.lat}`).join(';');
                const url = `${OSRM_BASE_URL}/table/v1/driving/${formattedCoords}?annotations=distance,duration`;

                const response = await axiosClient.get(url, {
                    timeout: OSRM_TIMEOUT,
                });

                if (!response || !response.data || response.data.code !== 'Ok') {
                    throw new Error(`OSRM table returned error code: ${response?.data?.code || 'UNKNOWN'}`);
                }

                return {
                    fallback: false,
                    durations: response.data.durations,
                    distances: response.data.distances || null,
                    sources: response.data.sources || validatedPoints.map(p => ({ location: [p.lon, p.lat] })),
                    destinations: response.data.destinations || validatedPoints.map(p => ({ location: [p.lon, p.lat] })),
                    circuitBreakerState: osrmCircuitBreaker.getState()
                };
            });
        });
    } catch (error) {
        const fallbackMatrix = calculateHaversineDistanceMatrix(coordinates, options);
        return {
            fallback: true,
            durations: fallbackMatrix.durations,
            distances: fallbackMatrix.distances,
            sources: fallbackMatrix.sources,
            destinations: fallbackMatrix.destinations,
            tortuosityFactor: fallbackMatrix.tortuosityFactor,
            averageSpeedKmh: fallbackMatrix.averageSpeedKmh,
            message: 'OSRM distance matrix degraded. Returning Haversine curvature matrix.',
            error: error.message,
            circuitBreakerState: osrmCircuitBreaker.getState()
        };
    }
};

export default {
    getRouteWithResilience,
    getDistanceMatrixWithResilience,
    calculateHaversineDistanceMatrix,
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
