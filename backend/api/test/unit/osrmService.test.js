import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    validateCoordinate,
    calculateStraightLineDistance,
    estimateDurationFromDistance,
    buildOSRMUrl,
    fetchRouteFromOSRM,
    getRouteWithResilience,
    setAxiosClientForTesting,
    resetAxiosClient
} from '../../src/services/osrmService.js';

describe('osrmService - Telematics Routing & Haversine Resilience Engine', () => {
    let mockAxios;

    beforeEach(() => {
        mockAxios = {
            get: vi.fn()
        };
        setAxiosClientForTesting(mockAxios);
    });

    afterEach(() => {
        resetAxiosClient();
        vi.restoreAllMocks();
    });

    describe('validateCoordinate', () => {
        it('should validate and parse valid coordinates', () => {
            const coord = validateCoordinate('77.5946', '12.9716', 'Bangalore');
            expect(coord).toEqual({ lon: 77.5946, lat: 12.9716 });
        });

        it('should accept numerical coordinates at boundary extremes', () => {
            expect(validateCoordinate(-180, -90)).toEqual({ lon: -180, lat: -90 });
            expect(validateCoordinate(180, 90)).toEqual({ lon: 180, lat: 90 });
            expect(validateCoordinate(0, 0)).toEqual({ lon: 0, lat: 0 });
        });

        it('should reject non-finite or missing coordinates', () => {
            expect(() => validateCoordinate('abc', 10)).toThrow('must be finite numbers');
            expect(() => validateCoordinate(10, NaN)).toThrow('must be finite numbers');
            expect(() => validateCoordinate(null, undefined)).toThrow('must be finite numbers');
        });

        it('should reject out-of-range latitude (> 90 or < -90)', () => {
            expect(() => validateCoordinate(77.59, 91.2)).toThrow('Latitude must be between -90 and 90');
            expect(() => validateCoordinate(77.59, -95.0)).toThrow('Latitude must be between -90 and 90');
        });

        it('should reject out-of-range longitude (> 180 or < -180)', () => {
            expect(() => validateCoordinate(185.0, 12.97)).toThrow('Longitude must be between -180 and 180');
            expect(() => validateCoordinate(-181.5, 12.97)).toThrow('Longitude must be between -180 and 180');
        });
    });

    describe('calculateStraightLineDistance', () => {
        it('should calculate Haversine distance between Bangalore and Chennai correctly (~290 km)', () => {
            // Bangalore: 77.5946, 12.9716
            // Chennai: 80.2707, 13.0827
            const distanceMeters = calculateStraightLineDistance(77.5946, 12.9716, 80.2707, 13.0827);
            const distanceKm = distanceMeters / 1000;

            expect(distanceKm).toBeGreaterThan(280);
            expect(distanceKm).toBeLessThan(300);
        });

        it('should return 0 meters for identical origin and destination', () => {
            const distance = calculateStraightLineDistance(77.5, 12.5, 77.5, 12.5);
            expect(distance).toBe(0);
        });
    });

    describe('estimateDurationFromDistance', () => {
        it('should calculate duration based on distance and assumed velocity', () => {
            // 80 km at 40 km/h = 2 hours = 7200 seconds
            const durationSec = estimateDurationFromDistance(80000, 40);
            expect(durationSec).toBe(7200);
        });

        it('should reject negative or non-finite distance', () => {
            expect(() => estimateDurationFromDistance(-500)).toThrow('Distance must be a non-negative finite number');
            expect(() => estimateDurationFromDistance(NaN)).toThrow('Distance must be a non-negative finite number');
        });
    });

    describe('buildOSRMUrl', () => {
        it('should format valid OSRM routing endpoint URL', () => {
            const url = buildOSRMUrl(77.5, 12.5, 78.5, 13.5);
            expect(url).toContain('/route/v1/driving/77.5,12.5;78.5,13.5');
            expect(url).toContain('overview=full');
            expect(url).toContain('geometries=geojson');
        });
    });

    describe('fetchRouteFromOSRM', () => {
        it('should return route object when OSRM returns code Ok', async () => {
            const mockRoute = {
                distance: 125000,
                duration: 9000,
                geometry: { type: 'LineString', coordinates: [[77.5, 12.5], [78.5, 13.5]] }
            };

            mockAxios.get.mockResolvedValueOnce({
                data: {
                    code: 'Ok',
                    routes: [mockRoute]
                }
            });

            const route = await fetchRouteFromOSRM(77.5, 12.5, 78.5, 13.5);
            expect(route).toEqual(mockRoute);
            expect(mockAxios.get).toHaveBeenCalledTimes(1);
        });

        it('should throw error when OSRM responds with non-Ok status code', async () => {
            mockAxios.get.mockResolvedValueOnce({
                data: {
                    code: 'NoRoute',
                    routes: []
                }
            });

            await expect(fetchRouteFromOSRM(77.5, 12.5, 78.5, 13.5))
                .rejects
                .toThrow('OSRM returned error code: NoRoute');
        });

        it('should throw error when OSRM returns empty routes', async () => {
            mockAxios.get.mockResolvedValueOnce({
                data: {
                    code: 'Ok',
                    routes: []
                }
            });

            await expect(fetchRouteFromOSRM(77.5, 12.5, 78.5, 13.5))
                .rejects
                .toThrow('OSRM returned empty routes array');
        });
    });

    describe('getRouteWithResilience', () => {
        it('should return live OSRM route on success', async () => {
            const liveRoute = {
                distance: 54000,
                duration: 4200,
                geometry: { type: 'LineString', coordinates: [[77.1, 12.1], [77.3, 12.4]] }
            };

            mockAxios.get.mockResolvedValueOnce({
                data: {
                    code: 'Ok',
                    routes: [liveRoute]
                }
            });

            const result = await getRouteWithResilience(77.1, 12.1, 77.3, 12.4);
            expect(result).toEqual(liveRoute);
            expect(result.fallback).toBeUndefined();
        });

        it('should activate Haversine fallback estimation when OSRM service times out or errors', async () => {
            mockAxios.get.mockRejectedValue(new Error('ECONNREFUSED: OSRM service daemon unavailable'));

            const result = await getRouteWithResilience(77.1, 12.1, 77.3, 12.4);

            expect(result.fallback).toBe(true);
            expect(result.distance).toBeTypeOf('number');
            expect(result.distance).toBeGreaterThan(0);
            expect(result.duration).toBeTypeOf('number');
            expect(result.duration).toBeGreaterThan(0);
            expect(result.geometry.type).toBe('LineString');
            expect(result.geometry.coordinates).toEqual([[77.1, 12.1], [77.3, 12.4]]);
            expect(result.message).toContain('OSRM service degraded');
        });
    });
});
