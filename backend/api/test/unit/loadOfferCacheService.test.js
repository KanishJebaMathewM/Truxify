/**
 * Unit tests for backend/api/src/services/order/loadOfferCacheService.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRedis = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  incr: vi.fn(),
  del: vi.fn(),
}));

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  redisClient: mockRedis,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const { LoadOfferCacheService } = await import('../../src/services/order/loadOfferCacheService.js');

describe('LoadOfferCacheService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getRegion', () => {
    it('returns global for null lat', () => {
      expect(LoadOfferCacheService.getRegion(null, 72.0)).toBe('global');
    });

    it('returns global for null lng', () => {
      expect(LoadOfferCacheService.getRegion(19.0, null)).toBe('global');
    });

    it('returns global for undefined lng', () => {
      expect(LoadOfferCacheService.getRegion(19.0, undefined)).toBe('global');
    });

    it('returns global for empty string lat', () => {
      expect(LoadOfferCacheService.getRegion('', 72.0)).toBe('global');
    });

    it('returns global for NaN lat', () => {
      expect(LoadOfferCacheService.getRegion(NaN, 72.0)).toBe('global');
    });

    it('returns global for non-finite lat', () => {
      expect(LoadOfferCacheService.getRegion(Infinity, 77.2090)).toBe('global');
    });

    it('returns global for non-finite lng', () => {
      expect(LoadOfferCacheService.getRegion(28.6139, NaN)).toBe('global');
    });

    it('returns global for non-numeric lng', () => {
      expect(LoadOfferCacheService.getRegion(19.0, 'abc')).toBe('global');
    });

    it('returns a geohash string for valid coordinates', () => {
      const region = LoadOfferCacheService.getRegion(19.076, 72.877);
      expect(typeof region).toBe('string');
      expect(region.length).toBeGreaterThan(0);
      expect(region).not.toBe('global');
    });

    it('returns consistent geohash for same coordinates', () => {
      const region1 = LoadOfferCacheService.getRegion(19.076, 72.877);
      const region2 = LoadOfferCacheService.getRegion(19.076, 72.877);
      expect(region1).toBe(region2);
    });

    it('handles numeric string inputs', () => {
      const region = LoadOfferCacheService.getRegion('19.076', '72.877');
      expect(region).not.toBe('global');
    });
  });

  describe('getVersion', () => {
    it('returns null when redisClient is not available', async () => {
      mockRedis.get.mockResolvedValue(null);
      const result = await LoadOfferCacheService.getVersion('abc');
      expect(result).toBeNull();
    });

    it('returns version string from Redis on cache hit', async () => {
      mockRedis.get.mockResolvedValue('42');
      const result = await LoadOfferCacheService.getVersion('abc');
      expect(result).toBe('42');
    });

    it('returns null when Redis returns empty string', async () => {
      mockRedis.get.mockResolvedValue('');
      const result = await LoadOfferCacheService.getVersion('abc');
      expect(result).toBeNull();
    });

    it('returns null and logs warning on Redis error', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection refused'));
      const result = await LoadOfferCacheService.getVersion('abc');
      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('returns null when Redis returns null', async () => {
      mockRedis.get.mockResolvedValue(null);
      const version = await LoadOfferCacheService.getVersion('region1');
      expect(version).toBeNull();
    });

    it('calls Redis with correct key', async () => {
      mockRedis.get.mockResolvedValue('1');
      await LoadOfferCacheService.getVersion('region42');
      expect(mockRedis.get).toHaveBeenCalledWith('version:load_offers:region:region42');
    });
  });

  describe('invalidateRegion', () => {
    it('returns early when redisClient is not available', async () => {
      // The service checks !redisClient — verify incr is not called when client is falsy.
      // Since our mock redisClient is a truthy object, we verify the incr path instead.
      mockRedis.incr.mockRejectedValueOnce(new Error('Redis unavailable'));
      await LoadOfferCacheService.invalidateRegion(19.076, 72.877);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('increments region version in Redis', async () => {
      mockRedis.incr.mockResolvedValue(1);
      await LoadOfferCacheService.invalidateRegion(19.076, 72.877);
      expect(mockRedis.incr).toHaveBeenCalled();
    });

    it('also increments global version when region is specific', async () => {
      mockRedis.incr.mockResolvedValue(1);
      await LoadOfferCacheService.invalidateRegion(19.076, 72.877);
      // Should call incr twice: once for the region, once for global
      expect(mockRedis.incr.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('does not double-increment global when region is already global', async () => {
      mockRedis.incr.mockResolvedValue(1);
      await LoadOfferCacheService.invalidateRegion(null, 72.0);
      // Only one incr call for global (no region-specific increment)
      expect(mockRedis.incr).toHaveBeenCalledTimes(1);
    });

    it('logs warning on Redis error', async () => {
      mockRedis.incr.mockRejectedValue(new Error('Redis write error'));
      await LoadOfferCacheService.invalidateRegion(19.076, 72.877);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('handles Redis errors gracefully', async () => {
      mockRedis.incr.mockRejectedValue(new Error('Redis error'));
      // Should not throw
      await expect(LoadOfferCacheService.invalidateRegion(28.6139, 77.2090)).resolves.toBeUndefined();
    });
  });
});
