import { jest } from '@jest/globals';
import CacheManager from '../../src/cache/CacheManager.js';
import { CacheKeyBuilder } from '../../src/cache/CacheKeyBuilder.js';

describe('CacheManager Singleflight Coalescing', () => {
  let mockRedisClient;
  let fetcherSpy;

  beforeEach(() => {
    mockRedisClient = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };

    CacheManager.init(mockRedisClient);
    CacheManager.resetStats();
    
    // Create a fetcher that resolves after a slight delay
    // to simulate network/db latency and ensure promises can queue up.
    fetcherSpy = jest.fn().mockImplementation(() => {
      return new Promise((resolve) => {
        setTimeout(() => resolve({ value: 'fetched_data' }), 50);
      });
    });
  });

  afterEach(() => {
    CacheManager.shutdown();
    jest.clearAllMocks();
  });

  it('should trigger fetcher exactly once for N concurrent cache misses on the same key', async () => {
    const namespace = 'test';
    const entityId = '123';
    
    // Simulate 100 concurrent requests for the same expired/missing cache key
    const numRequests = 100;
    const promises = [];
    
    for (let i = 0; i < numRequests; i++) {
      promises.push(CacheManager.getOrSetSingleflight(namespace, entityId, fetcherSpy, { ttl: 60 }));
    }
    
    const results = await Promise.all(promises);
    
    // Assert exactly 1 fetcher execution occurred
    expect(fetcherSpy).toHaveBeenCalledTimes(1);
    
    // All 100 promises should resolve with the exact same data
    results.forEach((res) => {
      expect(res).toEqual({ value: 'fetched_data' });
    });
    
    // Stats should reflect 1 miss and 99 coalesced hits
    const stats = CacheManager.getStats().cache;
    expect(stats.misses).toBe(100); // 100 initial GET misses
    expect(stats.coalesced).toBe(99); // 99 grouped to the singleflight promise
    expect(stats.sets).toBe(1); // 1 SET operation after the fetcher completed
    
    // Verify Redis calls
    const expectedKey = CacheKeyBuilder.build(namespace, entityId, undefined);
    expect(mockRedisClient.get).toHaveBeenCalledTimes(100);
    expect(mockRedisClient.set).toHaveBeenCalledTimes(1);
    expect(mockRedisClient.set).toHaveBeenCalledWith(
      expectedKey,
      JSON.stringify({ value: 'fetched_data' }),
      'EX',
      60
    );
  });

  it('should not coalesce if keys are different', async () => {
    const namespace = 'test';
    
    const promises = [];
    // 5 concurrent requests, but each for a DIFFERENT entityId
    for (let i = 0; i < 5; i++) {
      promises.push(CacheManager.getOrSetSingleflight(namespace, `id_${i}`, fetcherSpy, { ttl: 60 }));
    }
    
    await Promise.all(promises);
    
    // Assert fetcher was executed 5 times, since keys are unique
    expect(fetcherSpy).toHaveBeenCalledTimes(5);
    
    const stats = CacheManager.getStats().cache;
    expect(stats.misses).toBe(5);
    expect(stats.coalesced).toBe(0);
    expect(stats.sets).toBe(5);
  });

  it('should clean up the in-flight map after the fetcher promise resolves or rejects', async () => {
    const namespace = 'test';
    const entityId = 'cleanup_test';
    
    // First round: 10 concurrent requests
    const firstRound = Array.from({ length: 10 }).map(() =>
      CacheManager.getOrSetSingleflight(namespace, entityId, fetcherSpy)
    );
    await Promise.all(firstRound);
    expect(fetcherSpy).toHaveBeenCalledTimes(1);
    expect(CacheManager.getStats().cache.coalesced).toBe(9);
    
    // Ensure inFlight map is clean (by verifying another fetcher triggers)
    // First, let's mock redis.get to STILL return null (simulate cache expiry)
    mockRedisClient.get.mockResolvedValueOnce(null);
    
    await CacheManager.getOrSetSingleflight(namespace, entityId, fetcherSpy);
    
    // fetcher should be called a 2nd time because the original promise was cleaned up
    expect(fetcherSpy).toHaveBeenCalledTimes(2);
    expect(CacheManager.getStats().cache.coalesced).toBe(9);
  });

  it('should correctly propagate errors and clean up the in-flight map if fetcher rejects', async () => {
    const namespace = 'test';
    const entityId = 'error_test';
    
    const errorFetcher = jest.fn().mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Database timeout')), 50);
      });
    });
    
    const promises = Array.from({ length: 5 }).map(() =>
      CacheManager.getOrSetSingleflight(namespace, entityId, errorFetcher).catch(err => err.message)
    );
    
    const results = await Promise.all(promises);
    
    // All 5 promises should reject with the same error
    results.forEach((res) => {
      expect(res).toBe('Database timeout');
    });
    
    expect(errorFetcher).toHaveBeenCalledTimes(1);
    expect(CacheManager.getStats().cache.coalesced).toBe(4);
    
    // Subsequent calls should re-trigger the fetcher since inFlight map was cleaned up
    mockRedisClient.get.mockResolvedValueOnce(null);
    await CacheManager.getOrSetSingleflight(namespace, entityId, errorFetcher).catch(() => {});
    expect(errorFetcher).toHaveBeenCalledTimes(2);
  });

  it('should correctly propagate errors and clean up the in-flight map if fetcher throws synchronously', async () => {
    const namespace = 'test';
    const entityId = 'sync_error_test';
    
    const syncErrorFetcher = jest.fn().mockImplementation(() => {
      throw new Error('Synchronous error');
    });
    
    const promises = Array.from({ length: 3 }).map(() =>
      CacheManager.getOrSetSingleflight(namespace, entityId, syncErrorFetcher).catch(err => err.message)
    );
    
    const results = await Promise.all(promises);
    
    // All promises should reject with the same error
    results.forEach((res) => {
      expect(res).toBe('Synchronous error');
    });
    
    expect(syncErrorFetcher).toHaveBeenCalledTimes(1);
    
    // Subsequent calls should re-trigger the fetcher since inFlight map was cleaned up
    mockRedisClient.get.mockResolvedValueOnce(null);
    await CacheManager.getOrSetSingleflight(namespace, entityId, syncErrorFetcher).catch(() => {});
    expect(syncErrorFetcher).toHaveBeenCalledTimes(2);
  });
});
