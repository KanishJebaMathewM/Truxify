const ExponentialBackoff = require('../utils/exponentialBackoff');
const CircuitBreaker = require('../utils/circuitBreaker');

const OSRM_BASE_URL = process.env.OSRM_BASE_URL || 'http://localhost:5000';
const OSRM_TIMEOUT = parseInt(process.env.OSRM_TIMEOUT || '5000', 10);

const osrmBackoff = new ExponentialBackoff({
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    factor: 2,
    jitter: true,
});

const osrmCircuitBreaker = new CircuitBreaker({
    name: 'osrm-routing',
    failureThreshold: 5,
    resetTimeout: 30000,
});

const fetchRouteFromOSRM = async (startLon, startLat, endLon, endLat) => {
    const url = `${OSRM_BASE_URL}/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson`;

    const response = await fetch(url, {
        signal: AbortSignal.timeout(OSRM_TIMEOUT),
    });

    if (!response.ok) {
        throw new Error(`OSRM HTTP error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.code !== 'Ok') {
        throw new Error(`OSRM returned error code: ${data.code}`);
    }

    return data.routes[0];
};

const getRouteWithResilience = async (startLon, startLat, endLon, endLat) => {
    try {
        return await osrmCircuitBreaker.execute(async () => {
            return await osrmBackoff.execute(async () => {
                return await fetchRouteFromOSRM(startLon, startLat, endLon, endLat);
            });
        });
    } catch (error) {
        console.error('OSRM routing failed after retries and circuit breaker evaluation:', error.message);

        return {
            fallback: true,
            distance: calculateStraightLineDistance(startLon, startLat, endLon, endLat),
            duration: estimateDurationFromDistance(calculateStraightLineDistance(startLon, startLat, endLon, endLat)),
            geometry: {
                type: 'LineString',
                coordinates: [
                    [parseFloat(startLon), parseFloat(startLat)],
                    [parseFloat(endLon), parseFloat(endLat)]
                ]
            },
            message: 'OSRM service degraded. Returning straight-line estimation.',
        };
    }
};

const calculateStraightLineDistance = (lon1, lat1, lon2, lat2) => {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(R * c);
};

const estimateDurationFromDistance = (distanceMeters) => {
    const averageSpeedKmh = 40;
    const distanceKm = distanceMeters / 1000;
    const durationHours = distanceKm / averageSpeedKmh;
    return Math.round(durationHours * 3600);
};

module.exports = {
    getRouteWithResilience,
    calculateStraightLineDistance,
};
