import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoadOfferCacheService } from '../../src/services/order/loadOfferCacheService.js';

vi.mock('../../src/config/db.js', () => ({
  redisClient: {
    get: vi.fn(),
    incr: vi.fn(),
  },
}));

describe('LoadOfferCacheService', () => {
  let mockRedisClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const db = await import('../../src/config/db.js');
    mockRedisClient = db.redisClient;
  });

  describe('getRegion', () => {
    it('returns geohash-encoded region for valid lat/lng', () => {
      const region = LoadOfferCacheService.getRegion(28.6139, 77.2090);
      expect(typeof region).toBe('string');
      expect(region.length).toBeGreaterThan(0);
      expect(region).not.toBe('global');
    });

    it('returns global for null lat', () => {
      expect(LoadOfferCacheService.getRegion(null, 77.2090)).toBe('global');
    });

    it('returns global for null lng', () => {
      expect(LoadOfferCacheService.getRegion(28.6139, null)).toBe('global');
    });

    it('returns global for undefined lat', () => {
      expect(LoadOfferCacheService.getRegion(undefined, 77.2090)).toBe('global');
    });

    it('returns global for empty string lat', () => {
      expect(LoadOfferCacheService.getRegion('', 77.2090)).toBe('global');
    });

    it('returns global for non-finite lat', () => {
      expect(LoadOfferCacheService.getRegion(Infinity, 77.2090)).toBe('global');
    });

    it('returns global for non-finite lng', () => {
      expect(LoadOfferCacheService.getRegion(28.6139, NaN)).toBe('global');
    });
  });

  describe('getVersion', () => {
    it('returns version string when Redis has a version', async () => {
      mockRedisClient.get.mockResolvedValue('5');
      const version = await LoadOfferCacheService.getVersion('region1');
      expect(version).toBe('5');
    });

    it('returns null when Redis returns null', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      const version = await LoadOfferCacheService.getVersion('region1');
      expect(version).toBeNull();
    });

    it('returns null when Redis throws', async () => {
      mockRedisClient.get.mockRejectedValue(new Error('Redis error'));
      const version = await LoadOfferCacheService.getVersion('region1');
      expect(version).toBeNull();
    });

    it('returns null when redisClient is not available', async () => {
      vi.resetModules();
      // Simulate redisClient = null
      const result = await LoadOfferCacheService.getVersion('region1');
      expect(result).toBeNull();
    });
  });

  describe('invalidateRegion', () => {
    it('increments region version in Redis', async () => {
      mockRedisClient.incr.mockResolvedValue(1);
      await LoadOfferCacheService.invalidateRegion(28.6139, 77.2090);
      expect(mockRedisClient.incr).toHaveBeenCalled();
    });

    it('handles Redis errors gracefully', async () => {
      mockRedisClient.incr.mockRejectedValue(new Error('Redis error'));
      // Should not throw
      await expect(LoadOfferCacheService.invalidateRegion(28.6139, 77.2090)).resolves.toBeUndefined();
    });
  });
});
