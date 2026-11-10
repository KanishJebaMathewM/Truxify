import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockRedis = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  redisClient: mockRedis,
}));

global.fetch = vi.fn();

import {
  getLiveTrafficMultiplier,
  getLiveTrafficMultiplierEnterprise,
  getTrafficForRoute,
} from '../../src/services/trafficService.js';
import { getRouteEstimate, getRouteGeometry, buildStraightLineGeometry } from '../../src/services/osrm.js';

describe('trafficCoordinateBounds - Geographic range guard tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch.mockReset();
    mockRedis.get.mockReset();
    mockRedis.set.mockReset();
    process.env = { ...originalEnv };
    process.env.TOMTOM_API_KEY = 'mock-tomtom-key';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getLiveTrafficMultiplier boundary guards', () => {
    it('calls external API for valid coordinates', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ flowSegmentData: { currentTravelTime: 120, freeFlowTravelTime: 100 } }),
      });

      const mult = await getLiveTrafficMultiplier(28.6139, 77.2090);
      expect(mult).toBe(1.2);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('rejects lat > 90 (e.g. 95) without calling external API', async () => {
      const mult = await getLiveTrafficMultiplier(95, 77.2);
      expect(mult).toBe(1.0);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects lat < -90 (e.g. -91) without calling external API', async () => {
      const mult = await getLiveTrafficMultiplier(-91, 77.2);
      expect(mult).toBe(1.0);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects lng > 180 (e.g. 185) without calling external API', async () => {
      const mult = await getLiveTrafficMultiplier(28.6, 185);
      expect(mult).toBe(1.0);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects lng < -180 (e.g. -200) without calling external API', async () => {
      const mult = await getLiveTrafficMultiplier(28.6, -200);
      expect(mult).toBe(1.0);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('accepts exact boundary coordinates and 0 without rejecting', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ flowSegmentData: { currentTravelTime: 100, freeFlowTravelTime: 100 } }),
      });

      await getLiveTrafficMultiplier(0, 0);
      await getLiveTrafficMultiplier(90, 180);
      await getLiveTrafficMultiplier(-90, -180);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('getLiveTrafficMultiplierEnterprise boundary guards', () => {
    it('rejects out-of-bounds coordinates before querying Redis or external API', async () => {
      const mult = await getLiveTrafficMultiplierEnterprise(95, -200);
      expect(mult).toBe(1.0);
      expect(mockRedis.get).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects booleans and arrays without calling external API', async () => {
      expect(await getLiveTrafficMultiplierEnterprise(true, 77.2)).toBe(1.0);
      expect(await getLiveTrafficMultiplierEnterprise(28.6, [77.2])).toBe(1.0);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('getTrafficForRoute boundary guards', () => {
    it('rejects route with out-of-bounds origin without calling external API', async () => {
      const result = await getTrafficForRoute({
        origin: { lat: 95, lng: 77.2 },
        destination: { lat: 28.7, lng: 77.1 },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid route coordinates');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects route with out-of-bounds destination without calling external API', async () => {
      const result = await getTrafficForRoute({
        origin: { lat: 28.6, lng: 77.2 },
        destination: { lat: 28.7, lng: -200 },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid route coordinates');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('osrm getRouteEstimate & getRouteGeometry boundary guards', () => {
    it('getRouteEstimate returns null for out-of-bounds coordinates without calling fetch', async () => {
      const result = await getRouteEstimate({
        pickupLat: 95,
        pickupLng: 77.2,
        dropLat: 28.7,
        dropLng: 77.1,
      });

      expect(result).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('getRouteGeometry returns null for out-of-bounds coordinates without calling fetch', async () => {
      const result = await getRouteGeometry({
        originLat: 28.6,
        originLng: -200,
        destLat: 28.7,
        destLng: 77.1,
      });

      expect(result).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('buildStraightLineGeometry returns null for out-of-bounds coordinates', () => {
      const result = buildStraightLineGeometry({
        originLat: 95,
        originLng: 77.2,
        destLat: 28.7,
        destLng: 77.1,
      });

      expect(result).toBeNull();
    });
  });
});
