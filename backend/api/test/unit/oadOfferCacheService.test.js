import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRedis = {
  get: vi.fn(),
  incr: vi.fn(),
};

vi.mock('../../src/config/db.js', () => ({
  redisClient: mockRedis,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { LoadOfferCacheService } = await import('../../src/services/order/loadOfferCacheService.js');

describe('LoadOfferCacheService (region + version contract)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getRegion', () => {
    it('geohash-encodes valid coordinates at precision 4', () => {
      const region = LoadOfferCacheService.getRegion(13.0827, 80.2707);
      expect(region).toMatch(/^[a-z0-9]{4}$/);
    });

    it('returns distinct regions for distant coordinates', () => {
      const chennai = LoadOfferCacheService.getRegion(13.0827, 80.2707);
      const delhi = LoadOfferCacheService.getRegion(28.6139, 77.2090);
      expect(chennai).not.toBe(delhi);
    });

    it('falls back to global for missing or non-finite coordinates', () => {
      expect(LoadOfferCacheService.getRegion(undefined, 80)).toBe('global');
      expect(LoadOfferCacheService.getRegion(13, null)).toBe('global');
      expect(LoadOfferCacheService.getRegion('', 80)).toBe('global');
      expect(LoadOfferCacheService.getRegion('abc', 'def')).toBe('global');
    });
  });

  describe('getVersion', () => {
    it('returns the max of the region and global versions', async () => {
      mockRedis.get.mockImplementation((key) =>
        Promise.resolve(key.includes('region:chennai') ? '3' : '7'));
      const version = await LoadOfferCacheService.getVersion('chennai');
      expect(version).toBe('7');
    });

    it('prefers the region version when it is newer', async () => {
      mockRedis.get.mockImplementation((key) =>
        Promise.resolve(key.includes('region:chennai') ? '9' : '2'));
      const version = await LoadOfferCacheService.getVersion('chennai');
      expect(version).toBe('9');
    });

    it('returns null when no version has been published', async () => {
      mockRedis.get.mockResolvedValue(null);
      expect(await LoadOfferCacheService.getVersion('chennai')).toBeNull();
    });

    it('returns null when the Redis lookup fails', async () => {
      mockRedis.get.mockRejectedValue(new Error('connection lost'));
      expect(await LoadOfferCacheService.getVersion('chennai')).toBeNull();
    });
  });

  describe('invalidateRegion', () => {
    it('increments the region version key', async () => {
      mockRedis.incr.mockResolvedValue(4);
      await LoadOfferCacheService.invalidateRegion(13.0827, 80.2707);
      const region = LoadOfferCacheService.getRegion(13.0827, 80.2707);
      expect(mockRedis.incr).toHaveBeenCalledWith(`version:load_offers:region:${region}`);
    });

    it('increments the global key when coordinates are missing', async () => {
      mockRedis.incr.mockResolvedValue(2);
      await LoadOfferCacheService.invalidateRegion(null, null);
      expect(mockRedis.incr).toHaveBeenCalledWith('version:load_offers:region:global');
    });

    it('swallows Redis errors during invalidation', async () => {
      mockRedis.incr.mockRejectedValue(new Error('connection lost'));
      await expect(LoadOfferCacheService.invalidateRegion(13.0827, 80.2707)).resolves.toBeUndefined();
    });
  });
});
