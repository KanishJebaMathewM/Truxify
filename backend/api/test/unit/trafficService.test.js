import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// === Mocking External Dependencies ===
vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/config/db.js', () => ({
  redisClient: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

global.fetch = vi.fn();

import logger from '../../src/middleware/logger.js';
import { redisClient } from '../../src/config/db.js';
import { getLiveTrafficMultiplier, getLiveTrafficMultiplierEnterprise, trafficService } from '../../src/services/trafficService.js';

describe('TrafficService - Complete Enterprise & Edge Case Test Suite (Issues #14049 & #14108)', () => {
  const originalEnv = process.env;
  const originalTomTomKey = process.env.TOMTOM_API_KEY;
  const originalGoogleKey = process.env.GOOGLE_MAPS_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    global.fetch.mockReset();
    process.env = { ...originalEnv };
    delete process.env.TOMTOM_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    process.env = originalEnv;
    if (originalTomTomKey) process.env.TOMTOM_API_KEY = originalTomTomKey;
    else delete process.env.TOMTOM_API_KEY;
    if (originalGoogleKey) process.env.GOOGLE_MAPS_API_KEY = originalGoogleKey;
    else delete process.env.GOOGLE_MAPS_API_KEY;
  });

  // ============================================================================
  // 1. Coordinate Validation & Null/Undefined Edge Cases
  // ============================================================================
  describe('Coordinate Validation & Guard Clauses', () => {
    it('returns 1.0 when pickupLat is null', async () => {
      const multiplier = await getLiveTrafficMultiplier(null, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('returns 1.0 when pickupLng is null', async () => {
      const multiplier = await getLiveTrafficMultiplier(28.61, null);
      expect(multiplier).toBe(1.0);
    });

    it('returns 1.0 when both pickupLat and pickupLng are null', async () => {
      const multiplier = await getLiveTrafficMultiplier(null, null);
      expect(multiplier).toBe(1.0);
    });

    it('returns 1.0 when pickupLat is undefined', async () => {
      const multiplier = await getLiveTrafficMultiplier(undefined, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('returns 1.0 when pickupLng is undefined', async () => {
      const multiplier = await getLiveTrafficMultiplier(28.61, undefined);
      expect(multiplier).toBe(1.0);
    });

    it('returns 1.0 when pickupLat is NaN (non-finite)', async () => {
      const multiplier = await getLiveTrafficMultiplier(NaN, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('returns 1.0 when pickupLng is Infinity (non-finite)', async () => {
      const multiplier = await getLiveTrafficMultiplier(28.61, Infinity);
      expect(multiplier).toBe(1.0);
    });

    it('returns 1.0 when pickupLat is -Infinity', async () => {
      const multiplier = await getLiveTrafficMultiplier(-Infinity, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('returns 1.0 (default) when lat or lng is null via trafficService wrapper', async () => {
      const result1 = await trafficService.getLiveTrafficMultiplier(null, 77.2);
      const result2 = await trafficService.getLiveTrafficMultiplier(28.6, null);
      const result3 = await trafficService.getLiveTrafficMultiplier(null, null);

      expect(result1).toBe(1.0);
      expect(result2).toBe(1.0);
      expect(result3).toBe(1.0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('returns 1.0 when coordinates are non-numeric strings or NaN via wrapper', async () => {
      expect(await trafficService.getLiveTrafficMultiplier('abc', 'xyz')).toBe(1.0);
      expect(await trafficService.getLiveTrafficMultiplier(NaN, 10)).toBe(1.0);
      expect(await trafficService.getLiveTrafficMultiplier({}, [])).toBe(1.0);
    });
  });

  // ============================================================================
  // 2. Redis Caching Layer Resilience
  // ============================================================================
  describe('Redis Caching Layer Resilience', () => {
    it('returns cached multiplier immediately if available, bypassing API and heuristic', async () => {
      redisClient.get.mockResolvedValueOnce('1.75');

      const result = await trafficService.getLiveTrafficMultiplier(12.97, 77.59);
      
      expect(result).toBe(1.75);
      expect(redisClient.get).toHaveBeenCalledWith('traffic_ent:12.970,77.590');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('gracefully handles redis read errors and proceeds to calculation', async () => {
      redisClient.get.mockRejectedValueOnce(new Error('Redis Timeout'));
      
      const result = await trafficService.getLiveTrafficMultiplier(10, 10);
      
      expect(result).toBeGreaterThanOrEqual(1.0);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Redis cache read failed'));
    });

    it('gracefully handles redis write errors after calculation', async () => {
      redisClient.get.mockResolvedValueOnce(null);
      redisClient.set.mockRejectedValueOnce(new Error('Write Timeout'));
      
      const result = await trafficService.getLiveTrafficMultiplier(10, 10);
      expect(result).toBeGreaterThanOrEqual(1.0);
    });
  });

  // ============================================================================
  // 3. TomTom API Integration & Error Fallbacks
  // ============================================================================
  describe('TomTom API Integration & Error Fallbacks', () => {
    beforeEach(() => {
      process.env.TOMTOM_API_KEY = 'mock-tomtom-key';
      if (redisClient && redisClient.get) {
        redisClient.get.mockResolvedValue(null);
      }
    });

    it('calculates correct multiplier from TomTom speedDiffPercent (positive traffic delay)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          flowSegmentData: { speedDiffPercent: 45 }
        })
      });
      vi.stubGlobal('fetch', mockFetch);

      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.45);
      expect(logger.info).toHaveBeenCalled();
    });

    it('clamps TomTom multiplier to MAX_SURGE_MULTIPLIER (2.5) when speedDiffPercent is extremely high', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          flowSegmentData: { speedDiffPercent: 200 }
        })
      });
      vi.stubGlobal('fetch', mockFetch);

      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(2.5);
    });

    it('clamps TomTom multiplier to minimum 1.0 when speedDiffPercent is negative', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          flowSegmentData: { speedDiffPercent: -20 }
        })
      });
      vi.stubGlobal('fetch', mockFetch);

      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('falls back gracefully to 1.0 and logs error when TomTom API returns non-OK status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503
      });
      vi.stubGlobal('fetch', mockFetch);

      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
      expect(logger.error).toHaveBeenCalled();
    });

    it('falls back gracefully to 1.0 when TomTom fetch throws a network exception', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));
      vi.stubGlobal('fetch', mockFetch);

      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
      expect(logger.error).toHaveBeenCalled();
    });

    it('raises the surge multiplier when TomTom reports slower traffic (speedDiffPercent -35 => 1.35)', async () => {
      process.env.TOMTOM_API_KEY = 'test-key';
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ flowSegmentData: { speedDiffPercent: -35 } }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await getLiveTrafficMultiplier(23.5, 72.5);
      expect(result).toBe(1.35);
    });
  });

  // ============================================================================
  // 4. Google Maps Distance Matrix API Integration & Error Fallback Tests
  // ============================================================================
  describe('Google Maps Distance Matrix API Integration & Error Fallbacks', () => {
    beforeEach(() => {
      process.env.GOOGLE_MAPS_API_KEY = 'mock-google-key';
      if (redisClient && redisClient.get) {
        redisClient.get.mockResolvedValue(null);
      }
    });

    it('calculates correct multiplier from Google duration_in_traffic vs normal duration', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          rows: [{
            elements: [{
              duration_in_traffic: { value: 1500 },
              duration: { value: 1000 }
            }]
          }]
        })
      });
      vi.stubGlobal('fetch', mockFetch);

      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.5);
      expect(logger.info).toHaveBeenCalled();
    });

    it('defaults to 1.0 when Google traffic duration elements are missing or zero', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          rows: [{
            elements: [{
              duration_in_traffic: null,
              duration: { value: 1000 }
            }]
          }]
        })
      });
      vi.stubGlobal('fetch', mockFetch);

      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('falls back gracefully to 1.0 when Google Maps API returns non-OK status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429
      });
      vi.stubGlobal('fetch', mockFetch);

      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
      expect(logger.error).toHaveBeenCalled();
    });

    it('falls back gracefully to 1.0 when Google fetch throws a network exception', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('DNS resolution failed'));
      vi.stubGlobal('fetch', mockFetch);

      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // 5. Rush-Hour Deterministic Fallback & Boundary Window Tests
  // ============================================================================
  describe('Rush-Hour Fallback & Multiplier Boundaries (No API Key Configured)', () => {
    it('returns base 1.0 multiplier during non-rush hour (e.g., 02:00 UTC)', async () => {
      vi.setSystemTime(new Date('2026-09-19T02:00:00Z'));
      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('returns base 1.0 multiplier during midday lull (e.g., 12:00 UTC)', async () => {
      vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('returns base 1.0 multiplier during late night (e.g., 22:00 UTC)', async () => {
      vi.setSystemTime(new Date('2026-09-19T22:00:00Z'));
      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('reaches MIN_SURGE_MULTIPLIER (1.2) precisely at morning window edge start (07:00 UTC)', async () => {
      vi.setSystemTime(new Date('2026-09-19T07:00:00Z'));
      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBeCloseTo(1.20, 2);
    });

    it('returns to base/min surge at morning window edge end (10:00 UTC)', async () => {
      vi.setSystemTime(new Date('2026-09-19T10:00:00Z'));
      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('peaks during morning rush window center (08:30 UTC)', async () => {
      vi.setSystemTime(new Date('2026-09-19T08:30:00Z'));
      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBeCloseTo(2.33, 2);
    });

    it('reaches MIN_SURGE_MULTIPLIER (1.2) precisely at evening window edge start (16:00 UTC)', async () => {
      vi.setSystemTime(new Date('2026-09-19T16:00:00Z'));
      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBeCloseTo(1.20, 2);
    });

    it('returns to base at evening window edge end (19:00 UTC)', async () => {
      vi.setSystemTime(new Date('2026-09-19T19:00:00Z'));
      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('peaks during evening rush window center (17:30 UTC)', async () => {
      vi.setSystemTime(new Date('2026-09-19T17:30:00Z'));
      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBeCloseTo(2.33, 2);
    });

    it('handles invalid Date object passed internally gracefully', async () => {
      vi.setSystemTime(new Date('invalid-date-string'));
      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('guards against null or undefined date inputs in rush hour heuristic', () => {
      expect(trafficService.getRushHourMultiplier(null)).toBe(1.0);
      expect(trafficService.getRushHourMultiplier(undefined)).toBe(1.0);
    });
  });

  // ============================================================================
  // 6. Enterprise Volume Boost & Concurrency Safety Tests
  // ============================================================================
  describe('Enterprise Volume Boost & Concurrency Safety', () => {
    it('handles malformed structural payloads from TomTom gracefully and applies fallback', async () => {
      process.env.TOMTOM_API_KEY = 'mock_tomtom_key_corrupt';
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ unexpectedDataShape: true, flowSegmentData: null }),
      });
      
      const result = await trafficService.getLiveTrafficMultiplier(28.6, 77.2);
      expect(result).toBeGreaterThanOrEqual(1.0);
      expect(result).toBeLessThanOrEqual(2.5);
      expect(Number.isFinite(result)).toBe(true);
    });

    it('handles deeply nested missing fields in Google Maps API responses', async () => {
      process.env.GOOGLE_MAPS_API_KEY = 'mock_google_key_corrupt';
      delete process.env.TOMTOM_API_KEY;
      
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ routes: [ { legs: [ {} ] } ] })
      });
      
      const result = await trafficService.getLiveTrafficMultiplier(28.6, 77.2);
      expect(result).toBeGreaterThanOrEqual(1.0);
      expect(result).toBeLessThanOrEqual(2.5);
      expect(Number.isFinite(result)).toBe(true);
    });

    it('maintains strict thread-safety and limits during high-throughput concurrent geographic queries', async () => {
      const promises = Array.from({ length: 50 }).map(() => 
        trafficService.getLiveTrafficMultiplier(12.34, 56.78)
      );
      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(50);
      results.forEach(res => {
        expect(res).toBeGreaterThanOrEqual(1.0);
        expect(Number.isFinite(res)).toBe(true);
      });
    });
  });
});