import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const supabaseUrl = process.env.SUPABASE_URL || 'https://mock.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'mock-key';

export const GEO_KEY = 'truxify:driver_locations';
export const MAX_COMMERCIAL_SPEED_KMH = 160; // Max plausible highway speed before flagging spoofing

// Driver movement cache for speed anomaly detection: driverId -> { lon, lat, timestamp }
const driverPositionCache = new Map();

let redisClientInstance = null;
let supabaseClientInstance = createSupabaseClient(supabaseUrl, supabaseKey);

/**
 * Injects a mock Redis client for automated testing.
 * @param {Object|null} mockRedis
 */
export const setRedisClientForTesting = (mockRedis) => {
    redisClientInstance = mockRedis;
};

/**
 * Injects a mock Supabase client for automated testing.
 * @param {Object|null} mockSupabase
 */
export const setSupabaseClientForTesting = (mockSupabase) => {
    supabaseClientInstance = mockSupabase;
};

/**
 * Resets clients to default state.
 */
export const resetClients = () => {
    redisClientInstance = null;
    supabaseClientInstance = createSupabaseClient(supabaseUrl, supabaseKey);
    driverPositionCache.clear();
};

/**
 * Lazily establishes Redis connection if configured and not already open.
 */
export const connectRedis = async () => {
    if (!redisClientInstance) {
        try {
            const { createClient } = await import('redis');
            redisClientInstance = createClient({ url: redisUrl });
            redisClientInstance.on('error', (err) => {
                if (process.env.NODE_ENV !== 'test') {
                    console.error('Redis Location Service Error', err);
                }
            });
        } catch {
            return null;
        }
    }

    if (redisClientInstance && !redisClientInstance.isOpen && typeof redisClientInstance.connect === 'function') {
        try {
            await redisClientInstance.connect();
        } catch {
            // Fail open to Supabase if Redis connection fails
        }
    }
    return redisClientInstance;
};

/**
 * Validates spherical coordinates for longitude [-180, 180] and latitude [-90, 90].
 * @param {number|string} longitude
 * @param {number|string} latitude
 * @returns {{lon: number, lat: number}}
 */
export const validateCoordinates = (longitude, latitude) => {
    const lon = typeof longitude === 'number' ? longitude : parseFloat(longitude);
    const lat = typeof latitude === 'number' ? latitude : parseFloat(latitude);

    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        throw new Error('Coordinates must be finite numeric values');
    }
    if (lat < -90 || lat > 90) {
        throw new Error(`Invalid latitude: ${lat}. Must be between -90 and 90 degrees`);
    }
    if (lon < -180 || lon > 180) {
        throw new Error(`Invalid longitude: ${lon}. Must be between -180 and 180 degrees`);
    }

    return { lon, lat };
};

/**
 * Computes Haversine distance in meters between two coordinate points.
 */
export const calculateDistanceMeters = (lon1, lat1, lon2, lat2) => {
    const R = 6371e3;
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) *
        Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
};

/**
 * Detects GPS spoofing, CAN bus corruption, or impossible instantaneous teleportation.
 * @param {string} driverId
 * @param {number} newLon
 * @param {number} newLat
 * @param {number} currentTimestamp
 * @returns {{anomaly: boolean, calculatedSpeedKmh?: number}}
 */
export const checkSpeedAnomaly = (driverId, newLon, newLat, currentTimestamp = Date.now()) => {
    const prev = driverPositionCache.get(driverId);
    if (!prev) {
        driverPositionCache.set(driverId, { lon: newLon, lat: newLat, timestamp: currentTimestamp });
        return { anomaly: false };
    }

    const elapsedSeconds = (currentTimestamp - prev.timestamp) / 1000;
    // Discard zero or negative elapsed timestamps
    if (elapsedSeconds <= 0.001) {
        return { anomaly: false };
    }

    const distanceMeters = calculateDistanceMeters(prev.lon, prev.lat, newLon, newLat);
    const speedKmh = (distanceMeters / 1000) / (elapsedSeconds / 3600);

    if (speedKmh > MAX_COMMERCIAL_SPEED_KMH) {
        return { anomaly: true, calculatedSpeedKmh: Math.round(speedKmh) };
    }

    driverPositionCache.set(driverId, { lon: newLon, lat: newLat, timestamp: currentTimestamp });
    return { anomaly: false, calculatedSpeedKmh: Math.round(speedKmh) };
};

/**
 * Verifies or creates PostGIS geospatial indexes.
 */
export const ensureIndexes = async () => {
    try {
        if (supabaseClientInstance?.rpc) {
            await supabaseClientInstance.rpc('create_postgis_index_if_not_exists');
        }
    } catch (err) {
        if (process.env.NODE_ENV !== 'test') {
            console.warn('Could not verify PostGIS indexes:', err.message);
        }
    }
};

/**
 * Records driver telemetry in real-time Redis geospatial indices and persistent PostGIS database.
 * @param {string} driverId
 * @param {number|string} longitude
 * @param {number|string} latitude
 * @param {Object} options
 * @returns {Promise<boolean>}
 */
export const updateDriverLocation = async (driverId, longitude, latitude, options = {}) => {
    if (!driverId || typeof driverId !== 'string') {
        throw new Error('driverId must be a non-empty string');
    }

    const { lon, lat } = validateCoordinates(longitude, latitude);

    if (!options.bypassAnomalyCheck) {
        const anomalyResult = checkSpeedAnomaly(driverId, lon, lat, options.timestamp);
        if (anomalyResult.anomaly) {
            throw new Error(`Speed anomaly detected: Driver ${driverId} reported impossible speed of ${anomalyResult.calculatedSpeedKmh} km/h`);
        }
    }

    let redisSuccess = false;
    try {
        const client = await connectRedis();
        if (client?.geoAdd) {
            await client.geoAdd(GEO_KEY, {
                longitude: lon,
                latitude: lat,
                member: driverId,
            });
            redisSuccess = true;
        }
    } catch {
        // Fall open to persistent store if Redis is unavailable
    }

    try {
        if (supabaseClientInstance?.from) {
            const { error } = await supabaseClientInstance
                .from('driver_locations')
                .upsert({
                    driver_id: driverId,
                    longitude: lon,
                    latitude: lat,
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'driver_id' });

            if (error && !redisSuccess) {
                throw error;
            }
        }
        return true;
    } catch (dbErr) {
        if (redisSuccess) {
            return true; // Partially successful via in-memory geospatial index
        }
        throw new Error(`Failed to update location: ${dbErr.message}`);
    }
};

/**
 * Finds active commercial trucks within a specified geographic radius.
 * @param {number|string} longitude
 * @param {number|string} latitude
 * @param {number} radiusKm Search radius between 0.1 and 500 km
 * @param {number} limit Maximum results to return between 1 and 100
 * @returns {Promise<Array<{driverId: string, distanceKm: number}>>}
 */
export const findNearbyTrucks = async (longitude, latitude, radiusKm = 50, limit = 20) => {
    const { lon, lat } = validateCoordinates(longitude, latitude);

    const boundedRadius = Math.max(0.1, Math.min(500, Number(radiusKm) || 50));
    const boundedLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));

    try {
        const client = await connectRedis();
        if (client?.geoRadius) {
            const results = await client.geoRadius(GEO_KEY, {
                longitude: lon,
                latitude: lat,
                radius: boundedRadius,
                unit: 'km',
            }, {
                WITHDIST: true,
                COUNT: boundedLimit,
                SORT: 'ASC',
            });

            if (Array.isArray(results) && results.length > 0) {
                return results.map((res) => ({
                    driverId: res.member,
                    distanceKm: parseFloat(res.dist),
                }));
            }
        }
    } catch {
        // Fall through to PostGIS RPC lookup
    }

    try {
        if (supabaseClientInstance?.rpc) {
            const { data, error } = await supabaseClientInstance.rpc('find_nearby_drivers', {
                lon,
                lat,
                radius_meters: Math.round(boundedRadius * 1000),
                max_results: boundedLimit,
            });

            if (error) throw error;
            return Array.isArray(data) ? data : [];
        }
    } catch (err) {
        throw new Error(`Failed to find nearby trucks: ${err.message}`);
    }

    return [];
};

export default {
    updateDriverLocation,
    findNearbyTrucks,
    ensureIndexes,
    validateCoordinates,
    calculateDistanceMeters,
    checkSpeedAnomaly,
    setRedisClientForTesting,
    setSupabaseClientForTesting,
    resetClients,
    GEO_KEY,
    MAX_COMMERCIAL_SPEED_KMH
};
