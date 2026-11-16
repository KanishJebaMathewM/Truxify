import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrSetSingleflight, resetStats, getStats } from '../../src/cache/CacheManager.js';

describe('CacheManager Singleflight Unit Tests', () => {
  beforeEach(() => {
    resetStats();
  });

  it('should execute fetcherFn on cache miss and return data', async () => {
    const fetcherFn = vi.fn().mockResolvedValue({ orderId: 'ord-123', status: 'active' });
    const data = await getOrSetSingleflight('orders', 'ord-123', fetcherFn);

    expect(data).toEqual({ orderId: 'ord-123', status: 'active' });
    expect(fetcherFn).toHaveBeenCalledTimes(1);
  });

  it('should coalesce 5 concurrent requests for same key into 1 single fetcherFn execution', async () => {
    let callCount = 0;
    const fetcherFn = vi.fn(async () => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { tripId: 'trip-999', load: 'heavy' };
    });

    const requests = Array.from({ length: 5 }, () =>
      getOrSetSingleflight('trips', 'trip-999', fetcherFn)
    );

    const results = await Promise.all(requests);

    expect(results).toHaveLength(5);
    results.forEach((res) => {
      expect(res).toEqual({ tripId: 'trip-999', load: 'heavy' });
    });

    expect(fetcherFn).toHaveBeenCalledTimes(1);
    expect(callCount).toBe(1);

    const stats = getStats();
    expect(stats.cache.coalesced).toBe(4);
  });

  it('should correctly propagate errors and clean up the in-flight map if fetcher rejects', async () => {
    const errorFetcher = vi.fn().mockRejectedValue(new Error('Database timeout'));

    const promises = Array.from({ length: 5 }, () =>
      getOrSetSingleflight('orders', 'err-123', errorFetcher).catch(err => err.message)
    );

    const results = await Promise.all(promises);

    results.forEach((res) => {
      expect(res).toBe('Database timeout');
    });

    expect(errorFetcher).toHaveBeenCalledTimes(1);
    expect(getStats().cache.coalesced).toBe(4);

    // Subsequent calls should re-trigger since map was cleaned up
    await getOrSetSingleflight('orders', 'err-123', errorFetcher).catch(() => {});
    expect(errorFetcher).toHaveBeenCalledTimes(2);
  });

  it('should correctly propagate errors and clean up the in-flight map if fetcher throws synchronously', async () => {
    const syncErrorFetcher = vi.fn().mockImplementation(() => {
      throw new Error('Synchronous error');
    });

    const promises = Array.from({ length: 3 }, () =>
      getOrSetSingleflight('orders', 'sync-err', syncErrorFetcher).catch(err => err.message)
    );

    const results = await Promise.all(promises);

    results.forEach((res) => {
      expect(res).toBe('Synchronous error');
    });

    expect(syncErrorFetcher).toHaveBeenCalledTimes(1);
    expect(getStats().cache.coalesced).toBe(2);

    // Subsequent calls should re-trigger
    await getOrSetSingleflight('orders', 'sync-err', syncErrorFetcher).catch(() => {});
    expect(syncErrorFetcher).toHaveBeenCalledTimes(2);
  });
});
