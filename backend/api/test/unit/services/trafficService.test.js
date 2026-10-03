/**
 * Unit tests for trafficService.js
 *
 * Tests the getLiveTrafficMultiplier function including input validation,
 * API error handling, rush-hour fallback, and multiplier boundary conditions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { redisClient } from '../../../src/config/db.js';
import logger from '../../../src/middleware/logger.js';
import trafficService, { getLiveTrafficMultiplier, getLiveTrafficMultiplierEnterprise,
  getTrafficForRoute,
  getRushHourMultiplier,
} from '../../../src/services/trafficService.js';

const originalEnv = { ...process.env };

vi.mock('../../../src/config/db.js', () => ({
  redisClient: {
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn()
  }
}));
vi.mock('../../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}));
global.fetch = vi.fn();

describe('getLiveTrafficMultiplier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch.mockReset();
    redisClient.get.mockReset();
    redisClient.set.mockReset();
    process.env = { ...originalEnv };
    delete process.env.TOMTOM_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.useRealTimers();
  });

  describe('Route Traffic Lookup', () => {
    it('calculates route traffic using object origin and destination', async () => {
      const route = {
        origin: { lat: 12.9716, lng: 77.5946 },
        destination: { lat: 13.0827, lng: 80.2707 },
      };

      const result = await getTrafficForRoute(route);

      expect(result.success).toBe(true);
      expect(result.multiplier).toBeGreaterThanOrEqual(1.0);
      expect(result.multiplier).toBeLessThanOrEqual(2.5);
      expect(result.origin).toEqual({ lat: 12.9716, lng: 77.5946 });
      expect(result.destination).toEqual({ lat: 13.0827, lng: 80.2707 });
      expect(['low', 'moderate', 'heavy']).toContain(result.congestionLevel);
    });

    it('calculates route traffic using pickup and drop coordinates', async () => {
      const route = {
        pickup_lat: 28.6139,
        pickup_lng: 77.2090,
        drop_lat: 19.0760,
        drop_lng: 72.8777,
      };

      const result = await getTrafficForRoute(route);

      expect(result.success).toBe(true);
      expect(result.origin).toEqual({ lat: 28.6139, lng: 77.2090 });
      expect(result.destination).toEqual({ lat: 19.0760, lng: 72.8777 });
    });

    it('calculates route traffic using array coordinates', async () => {
      const route = {
        origin: [12.9716, 77.5946],
        destination: [13.0827, 80.2707],
      };

      const result = await getTrafficForRoute(route);

      expect(result.success).toBe(true);
      expect(result.origin).toEqual({ lat: 12.9716, lng: 77.5946 });
      expect(result.destination).toEqual({ lat: 13.0827, lng: 80.2707 });
    });

    it('calculates route traffic using comma-separated string coordinates', async () => {
      const route = {
        origin: '12.9716,77.5946',
        destination: '13.0827,80.2707',
      };

      const result = await getTrafficForRoute(route);

      expect(result.success).toBe(true);
      expect(result.origin).toEqual({ lat: 12.9716, lng: 77.5946 });
    });

    it('uses TomTom API when TOMTOM_API_KEY is configured', async () => {
      process.env.TOMTOM_API_KEY = 'mock-tomtom-key';

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          flowSegmentData: {
            speedDiffPercent: -50,
            currentDelaySec: 900,
          },
        }),
      });

      const route = {
        origin: { lat: 12.9716, lng: 77.5946 },
        destination: { lat: 13.0827, lng: 80.2707 },
      };

      const result = await getTrafficForRoute(route);

      expect(result.success).toBe(true);
      expect(result.multiplier).toBe(1.5);
      expect(result.delayMinutes).toBe(15);
      expect(result.congestionLevel).toBe('moderate');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('api.tomtom.com')
      );
    });

    it('uses Google Maps API when GOOGLE_MAPS_API_KEY is configured', async () => {
      process.env.GOOGLE_MAPS_API_KEY = 'mock-google-key';

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [
            {
              elements: [
                {
                  duration: { value: 1000 },
                  duration_in_traffic: { value: 2000 },
                },
              ],
            },
          ],
        }),
      });

      const route = {
        origin: { lat: 12.9716, lng: 77.5946 },
        destination: { lat: 13.0827, lng: 80.2707 },
      };

      const result = await getTrafficForRoute(route);

      expect(result.success).toBe(true);
      expect(result.multiplier).toBe(2.0);
      expect(result.delayMinutes).toBe(17);
      expect(result.congestionLevel).toBe('heavy');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('maps.googleapis.com')
      );
    });
  });

  describe('Cache Behavior (Hit / Miss / Error Handling)', () => {
    const route = {
      origin: { lat: 12.9716, lng: 77.5946 },
      destination: { lat: 13.0827, lng: 80.2707 },
    };

    it('returns cached traffic data on cache hit without calling external API', async () => {
      const cachedData = {
        success: true,
        multiplier: 1.85,
        congestionLevel: 'heavy',
        delayMinutes: 25,
        origin: { lat: 12.972, lng: 77.595 },
        destination: { lat: 13.083, lng: 80.271 },
      };

      redisClient.get.mockResolvedValueOnce(JSON.stringify(cachedData));

      const result = await getTrafficForRoute(route);

      expect(result).toEqual({
        ...cachedData,
        cached: true,
      });
      expect(redisClient.get).toHaveBeenCalledWith('traffic_route:12.972,77.595:13.083,80.271');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('computes traffic and populates Redis cache on cache miss', async () => {
      redisClient.get.mockResolvedValueOnce(null);
      redisClient.set.mockResolvedValueOnce('OK');

      const result = await getTrafficForRoute(route);

      expect(result.success).toBe(true);
      expect(redisClient.set).toHaveBeenCalledWith(
        'traffic_route:12.972,77.595:13.083,80.271',
        expect.stringContaining('"success":true'),
        'EX',
        300
      );
    });

    it('bypasses cache when options.skipCache is true', async () => {
      redisClient.get.mockResolvedValue(JSON.stringify({ multiplier: 2.5 }));

      const result = await getTrafficForRoute(route, { skipCache: true });

      expect(result.cached).toBeUndefined();
      expect(redisClient.get).not.toHaveBeenCalled();
    });

    it('continues and computes traffic when Redis read throws an error', async () => {
      redisClient.get.mockRejectedValueOnce(new Error('Redis Read Connection Error'));

      const result = await getTrafficForRoute(route);

      expect(result.success).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Redis route cache read failed')
      );
    });

    it('returns computed traffic safely when Redis write throws an error', async () => {
      redisClient.get.mockResolvedValueOnce(null);
      redisClient.set.mockRejectedValueOnce(new Error('Redis Write Error'));

      const result = await getTrafficForRoute(route);

      expect(result.success).toBe(true);
      expect(result.multiplier).toBeGreaterThanOrEqual(1.0);
    });
  });

  describe('External API Failure & Fallback Handling', () => {
    const route = {
      origin: { lat: 12.9716, lng: 77.5946 },
      destination: { lat: 13.0827, lng: 80.2707 },
    };

    it('falls back to rush-hour heuristic when TomTom returns non-200 status', async () => {
      process.env.TOMTOM_API_KEY = 'mock-key';

      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      const result = await getTrafficForRoute(route);

      expect(result.success).toBe(true);
      expect(result.fallback).toBe(true);
      expect(result.multiplier).toBeGreaterThanOrEqual(1.0);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining('Error fetching route traffic')
      );
    });

    it('falls back gracefully when Google Maps returns non-200 status', async () => {
      process.env.GOOGLE_MAPS_API_KEY = 'mock-key';

      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await getTrafficForRoute(route);

      expect(result.success).toBe(true);
      expect(result.fallback).toBe(true);
      expect(result.multiplier).toBeGreaterThanOrEqual(1.0);
    });

    it('falls back gracefully on network fetch rejection / exception', async () => {
      process.env.TOMTOM_API_KEY = 'mock-key';

      global.fetch.mockRejectedValueOnce(new Error('Network unreachable'));

      const result = await getTrafficForRoute(route);

      expect(result.success).toBe(true);
      expect(result.fallback).toBe(true);
      expect(result.multiplier).toBeGreaterThanOrEqual(1.0);
    });

    it('handles malformed Google Maps payload with missing elements without throwing', async () => {
      process.env.GOOGLE_MAPS_API_KEY = 'mock-key';

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [] }),
      });

      const result = await getTrafficForRoute(route);

      expect(result.success).toBe(true);
      expect(result.multiplier).toBe(1.0);
    });
  });

  describe('Invalid Route Handling', () => {
    it('returns error descriptor when route is null or undefined', async () => {
      const resNull = await getTrafficForRoute(null);
      const resUndef = await getTrafficForRoute(undefined);

      expect(resNull).toEqual({
        success: false,
        multiplier: 1.0,
        congestionLevel: 'unknown',
        delayMinutes: 0,
        error: 'Invalid route descriptor',
      });
      expect(resUndef).toEqual({
        success: false,
        multiplier: 1.0,
        congestionLevel: 'unknown',
        delayMinutes: 0,
        error: 'Invalid route descriptor',
      });
    });

    it('returns error descriptor when route is a primitive non-object', async () => {
      expect(await getTrafficForRoute('invalid-route')).toEqual({
        success: false,
        multiplier: 1.0,
        congestionLevel: 'unknown',
        delayMinutes: 0,
        error: 'Invalid route descriptor',
      });
      expect(await getTrafficForRoute(12345)).toEqual({
        success: false,
        multiplier: 1.0,
        congestionLevel: 'unknown',
        delayMinutes: 0,
        error: 'Invalid route descriptor',
      });
    });

    it('returns error descriptor when coordinates are missing or non-numeric', async () => {
      const res1 = await getTrafficForRoute({});
      const res2 = await getTrafficForRoute({ origin: { lat: 'abc', lng: 77.5 } });
      const res3 = await getTrafficForRoute({ origin: [NaN, 77.5], destination: [13.0, 80.2] });

      expect(res1.success).toBe(false);
      expect(res1.error).toBe('Invalid route coordinates');
      expect(res2.success).toBe(false);
      expect(res2.error).toBe('Invalid route coordinates');
      expect(res3.success).toBe(false);
      expect(res3.error).toBe('Invalid route coordinates');
    });
  });

  describe('Module Interface Export Verification', () => {
    it('exports trafficService with getTrafficForRoute', () => {
      expect(trafficService.getTrafficForRoute).toBe(getTrafficForRoute);
      expect(trafficService.getLiveTrafficMultiplier).toBe(getLiveTrafficMultiplierEnterprise);
      expect(trafficService.getRushHourMultiplier).toBe(getRushHourMultiplier);
    });
  });
});

describe('getLiveTrafficMultiplierEnterprise', () => {
  beforeEach(() => {
    delete process.env.TOMTOM_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it('returns 1.0 for non-finite (NaN / Infinity) coordinates before calculating', async () => {
    expect(await getLiveTrafficMultiplierEnterprise(NaN, 10)).toBe(1.0);
    expect(await getLiveTrafficMultiplierEnterprise(Infinity, 10)).toBe(1.0);
    expect(await getLiveTrafficMultiplierEnterprise(28.6, -Infinity)).toBe(1.0);
  });

  it('rejects non-numeric and overflow coordinate inputs', async () => {
    expect(await getLiveTrafficMultiplierEnterprise('abc', 'xyz')).toBe(1.0);
    expect(await getLiveTrafficMultiplierEnterprise('Infinity', '10')).toBe(1.0);
    expect(await getLiveTrafficMultiplierEnterprise(Number.MAX_VALUE * 2, 10)).toBe(1.0);
  });

  it('returns a finite multiplier between 1.0 and 2.5 for valid coordinates', async () => {
    const result = await getLiveTrafficMultiplierEnterprise(28.6139, 77.209);
    expect(result).toBeGreaterThanOrEqual(1.0);
    expect(result).toBeLessThanOrEqual(2.5);
    expect(Number.isFinite(result)).toBe(true);
  });
});
