import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    validateCoordinates,
    calculateDistanceMeters,
    checkSpeedAnomaly,
    updateDriverLocation,
    findNearbyTrucks,
    ensureIndexes,
    setRedisClientForTesting,
    setSupabaseClientForTesting,
    resetClients,
    GEO_KEY,
    MAX_COMMERCIAL_SPEED_KMH
} from '../../src/services/locationService.js';

describe('locationService - Telematics Geolocation & Speed Anomaly Defense', () => {
    let mockRedis;
    let mockSupabase;

    beforeEach(() => {
        mockRedis = {
            isOpen: true,
            connect: vi.fn().mockResolvedValue(undefined),
            geoAdd: vi.fn().mockResolvedValue(1),
            geoRadius: vi.fn().mockResolvedValue([])
        };

        mockSupabase = {
            from: vi.fn().mockReturnValue({
                upsert: vi.fn().mockResolvedValue({ error: null })
            }),
            rpc: vi.fn().mockResolvedValue({ data: [], error: null })
        };

        setRedisClientForTesting(mockRedis);
        setSupabaseClientForTesting(mockSupabase);
    });

    afterEach(() => {
        resetClients();
        vi.restoreAllMocks();
    });

    describe('validateCoordinates', () => {
        it('should correctly parse valid coordinates within spherical limits', () => {
            const res = validateCoordinates('77.5946', '12.9716');
            expect(res).toEqual({ lon: 77.5946, lat: 12.9716 });
        });

        it('should accept numerical limits at extrema (-180..180, -90..90)', () => {
            expect(validateCoordinates(-180, -90)).toEqual({ lon: -180, lat: -90 });
            expect(validateCoordinates(180, 90)).toEqual({ lon: 180, lat: 90 });
            expect(validateCoordinates(0, 0)).toEqual({ lon: 0, lat: 0 });
        });

        it('should reject non-numeric or non-finite inputs', () => {
            expect(() => validateCoordinates('invalid', 12)).toThrow('must be finite numeric values');
            expect(() => validateCoordinates(77, NaN)).toThrow('must be finite numeric values');
            expect(() => validateCoordinates(null, undefined)).toThrow('must be finite numeric values');
        });

        it('should reject out-of-range latitude (>90 or <-90)', () => {
            expect(() => validateCoordinates(77, 91.5)).toThrow('Invalid latitude: 91.5. Must be between -90 and 90 degrees');
            expect(() => validateCoordinates(77, -92)).toThrow('Invalid latitude: -92. Must be between -90 and 90 degrees');
        });

        it('should reject out-of-range longitude (>180 or <-180)', () => {
            expect(() => validateCoordinates(181, 12)).toThrow('Invalid longitude: 181. Must be between -180 and 180 degrees');
            expect(() => validateCoordinates(-182.4, 12)).toThrow('Invalid longitude: -182.4. Must be between -180 and 180 degrees');
        });
    });

    describe('calculateDistanceMeters', () => {
        it('should compute Haversine distance correctly between coordinates', () => {
            // Bangalore (77.5946, 12.9716) to Hyderabad (78.4867, 17.3850) is ~500 km
            const distance = calculateDistanceMeters(77.5946, 12.9716, 78.4867, 17.3850);
            const distanceKm = distance / 1000;
            expect(distanceKm).toBeGreaterThan(490);
            expect(distanceKm).toBeLessThan(510);
        });

        it('should return 0 meters for identical points', () => {
            expect(calculateDistanceMeters(77.5, 12.5, 77.5, 12.5)).toBe(0);
        });
    });

    describe('checkSpeedAnomaly', () => {
        it('should record initial coordinate without anomaly', () => {
            const result = checkSpeedAnomaly('driver-1', 77.5, 12.5, 1000000);
            expect(result.anomaly).toBe(false);
        });

        it('should permit reasonable truck speed (e.g. 80 km/h)', () => {
            // 80 km/h for 1 hour = 80 km
            // 1 degree latitude is approx 111 km, so ~0.72 deg in 3600 seconds
            checkSpeedAnomaly('driver-2', 77.0, 12.0, 1000000);
            const result = checkSpeedAnomaly('driver-2', 77.0, 12.72, 1000000 + 3600 * 1000);

            expect(result.anomaly).toBe(false);
            expect(result.calculatedSpeedKmh).toBeLessThanOrEqual(MAX_COMMERCIAL_SPEED_KMH);
        });

        it('should flag impossible instantaneous speed jumps (> 160 km/h)', () => {
            // Move ~300 km in 10 seconds -> ~108,000 km/h teleportation
            checkSpeedAnomaly('driver-3', 77.0, 12.0, 1000000);
            const result = checkSpeedAnomaly('driver-3', 80.0, 13.0, 1000000 + 10 * 1000);

            expect(result.anomaly).toBe(true);
            expect(result.calculatedSpeedKmh).toBeGreaterThan(MAX_COMMERCIAL_SPEED_KMH);
        });
    });

    describe('updateDriverLocation', () => {
        it('should successfully update driver location in Redis and Supabase', async () => {
            const success = await updateDriverLocation('driver-101', 77.5946, 12.9716);

            expect(success).toBe(true);
            expect(mockRedis.geoAdd).toHaveBeenCalledWith(GEO_KEY, {
                longitude: 77.5946,
                latitude: 12.9716,
                member: 'driver-101',
            });
            expect(mockSupabase.from).toHaveBeenCalledWith('driver_locations');
        });

        it('should reject missing or invalid driverId', async () => {
            await expect(updateDriverLocation('', 77.5, 12.5))
                .rejects
                .toThrow('driverId must be a non-empty string');
            await expect(updateDriverLocation(null, 77.5, 12.5))
                .rejects
                .toThrow('driverId must be a non-empty string');
        });

        it('should reject speed anomaly telematics jumps', async () => {
            await updateDriverLocation('teleporting-driver', 77.0, 12.0, { timestamp: 1000000 });
            await expect(updateDriverLocation('teleporting-driver', 85.0, 18.0, { timestamp: 1000000 + 10 * 1000 }))
                .rejects
                .toThrow('Speed anomaly detected: Driver teleporting-driver reported impossible speed');
        });

        it('should succeed even if Redis fails by storing in Supabase', async () => {
            mockRedis.geoAdd.mockRejectedValueOnce(new Error('Redis connection lost'));
            const success = await updateDriverLocation('driver-resilient', 77.5, 12.5);

            expect(success).toBe(true);
            expect(mockSupabase.from).toHaveBeenCalledWith('driver_locations');
        });
    });

    describe('findNearbyTrucks', () => {
        it('should return nearby drivers from Redis geospatial index when available', async () => {
            mockRedis.geoRadius.mockResolvedValueOnce([
                { member: 'driver-alpha', dist: '12.4' },
                { member: 'driver-beta', dist: '25.8' },
            ]);

            const trucks = await findNearbyTrucks(77.59, 12.97, 50, 10);

            expect(trucks).toHaveLength(2);
            expect(trucks[0]).toEqual({ driverId: 'driver-alpha', distanceKm: 12.4 });
            expect(trucks[1]).toEqual({ driverId: 'driver-beta', distanceKm: 25.8 });
            expect(mockSupabase.rpc).not.toHaveBeenCalled();
        });

        it('should fall back to PostGIS RPC when Redis cache returns empty results', async () => {
            mockRedis.geoRadius.mockResolvedValueOnce([]);
            mockSupabase.rpc.mockResolvedValueOnce({
                data: [{ driver_id: 'driver-db', distance_km: 18.5 }],
                error: null
            });

            const trucks = await findNearbyTrucks(77.59, 12.97, 30, 5);

            expect(mockSupabase.rpc).toHaveBeenCalledWith('find_nearby_drivers', {
                lon: 77.59,
                lat: 12.97,
                radius_meters: 30000,
                max_results: 5
            });
            expect(trucks).toEqual([{ driver_id: 'driver-db', distance_km: 18.5 }]);
        });

        it('should clamp radius and limit to secure boundaries', async () => {
            mockRedis.geoRadius.mockResolvedValueOnce([]);
            mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

            // Request with out-of-bound radius 9999 and limit 5000
            await findNearbyTrucks(77.5, 12.5, 9999, 5000);

            expect(mockSupabase.rpc).toHaveBeenCalledWith('find_nearby_drivers', {
                lon: 77.5,
                lat: 12.5,
                radius_meters: 500000, // Clamped to 500 km
                max_results: 100       // Clamped to 100
            });
        });
    });

    describe('ensureIndexes', () => {
        it('should invoke PostGIS index creation RPC', async () => {
            await ensureIndexes();
            expect(mockSupabase.rpc).toHaveBeenCalledWith('create_postgis_index_if_not_exists');
        });
    });
});
