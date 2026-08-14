import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: { redisClient: null },
}));

vi.mock('../../src/config/db.js', () => ({
  get redisClient() { return dbMock.redisClient; },
  get supabase() { return null; },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { LoadOfferCacheService } from '../../src/services/order/loadOfferCacheService.js';

describe('LoadOfferCacheService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.redisClient = null;
  });

  describe('getRegion', () => {
    it('returns global for missing lat/lng', () => {
      expect(LoadOfferCacheService.getRegion(undefined, 10)).toBe('global');
      expect(LoadOfferCacheService.getRegion(10, null)).toBe('global');
      expect(LoadOfferCacheService.getRegion('', '')).toBe('global');
    });

    it('returns global for non-finite numbers', () => {
      expect(LoadOfferCacheService.getRegion('abc', 10)).toBe('global');
      expect(LoadOfferCacheService.getRegion(10, NaN)).toBe('global');
    });

    it('returns a 4-char geohash for valid coordinates', () => {
      const region = LoadOfferCacheService.getRegion(12.9716, 77.5946);
      expect(region).toMatch(/^[a-z0-9]{4}$/);
      expect(region).not.toBe('global');
    });
  });

  describe('getVersion', () => {
    it('returns null when Redis is unavailable', async () => {
      expect(await LoadOfferCacheService.getVersion('region1')).toBeNull();
    });

    it('returns the version from Redis', async () => {
      dbMock.redisClient = { get: vi.fn().mockResolvedValue('3') };
      expect(await LoadOfferCacheService.getVersion('region1')).toBe('3');
    });

    it('returns null on Redis error', async () => {
      dbMock.redisClient = { get: vi.fn().mockRejectedValue(new Error('down')) };
      expect(await LoadOfferCacheService.getVersion('region1')).toBeNull();
    });
  });

  describe('invalidateRegion', () => {
    it('skips when Redis is unavailable', async () => {
      await LoadOfferCacheService.invalidateRegion(10, 20);
      expect(true).toBe(true);
    });

    it('increments the region and global versions', async () => {
      const incr = vi.fn().mockResolvedValue(1);
      dbMock.redisClient = { incr };
      await LoadOfferCacheService.invalidateRegion(12.9716, 77.5946);
      expect(incr).toHaveBeenCalledTimes(2);
    });

    it('increments only the global version for the global region', async () => {
      const incr = vi.fn().mockResolvedValue(1);
      dbMock.redisClient = { incr };
      await LoadOfferCacheService.invalidateRegion(null, null);
      expect(incr).toHaveBeenCalledTimes(1);
    });
  });
});
