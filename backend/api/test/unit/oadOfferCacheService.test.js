import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoadOfferCacheService } from '../../src/services/order/loadOfferCacheService.js';

// Mock the underlying cache implementation (e.g., Redis or an internal store)
// Note: Adjust this mock path if your cache client is imported from a specific utility file.
const mockCacheStore = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};

describe('LoadOfferCacheService', () => {
  let cacheService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Assuming the service takes the cache store as a dependency, 
    // or you can use vi.mock() at the top of the file if it's imported directly.
    cacheService = new LoadOfferCacheService(mockCacheStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Cache Key Generation', () => {
    it('should generate unique cache keys for different offer IDs', () => {
      const key1 = cacheService.generateCacheKey('offer-123');
      const key2 = cacheService.generateCacheKey('offer-456');
      
      expect(key1).not.toBe(key2);
      expect(key1).toContain('offer-123');
      expect(key2).toContain('offer-456');
    });
  });

  describe('Cache Hit/Miss Logic', () => {
    it('should return parsed data on a cache hit', async () => {
      const mockOffer = { id: 'offer-123', price: 1500 };
      mockCacheStore.get.mockResolvedValue(JSON.stringify(mockOffer));

      const result = await cacheService.getOffer('offer-123');
      
      expect(mockCacheStore.get).toHaveBeenCalledWith(cacheService.generateCacheKey('offer-123'));
      expect(result).toEqual(mockOffer);
    });

    it('should return null on a cache miss', async () => {
      mockCacheStore.get.mockResolvedValue(null);

      const result = await cacheService.getOffer('offer-999');
      
      expect(result).toBeNull();
      expect(mockCacheStore.get).toHaveBeenCalledWith(cacheService.generateCacheKey('offer-999'));
    });
  });

  describe('TTL Expiration Handling', () => {
    it('should set cache with the correct TTL', async () => {
      const mockOffer = { id: 'offer-123', price: 1500 };
      const ttlSeconds = 3600; // 1 hour

      await cacheService.setOffer('offer-123', mockOffer, ttlSeconds);
      
      expect(mockCacheStore.set).toHaveBeenCalledWith(
        cacheService.generateCacheKey('offer-123'),
        JSON.stringify(mockOffer),
        'EX',
        ttlSeconds
      );
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate cache on offer updates', async () => {
      const offerId = 'offer-123';
      
      await cacheService.invalidateOffer(offerId);
      
      expect(mockCacheStore.del).toHaveBeenCalledWith(cacheService.generateCacheKey(offerId));
    });
  });
});
