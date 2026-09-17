import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestCacheMiddleware } from '../../src/middleware/requestCacheMiddleware.js';
import { getRequestCache } from '../../src/lib/requestContext.js';

describe('requestCacheMiddleware', () => {
  let finishCallback;

  const mockRes = () => ({
    once: vi.fn((event, cb) => {
      if (event === 'finish') finishCallback = cb;
    }),
  });

  beforeEach(() => {
    finishCallback = undefined;
  });

  it('calls next immediately', () => {
    const res = mockRes();
    const next = vi.fn();
    requestCacheMiddleware({}, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('attaches finish listener to response', () => {
    const res = mockRes();
    requestCacheMiddleware({}, res, vi.fn());
    expect(res.once).toHaveBeenCalledWith('finish', expect.any(Function));
    expect(typeof finishCallback).toBe('function');
  });

  it('sets a requestCache in the requestContext store accessible via getRequestCache', () => {
    let capturedCache;
    const res = mockRes();

    requestCacheMiddleware({}, res, () => {
      capturedCache = getRequestCache();
    });

    expect(capturedCache).toBeDefined();
    expect(capturedCache).not.toBeNull();
    expect(typeof capturedCache.set).toBe('function');
    expect(typeof capturedCache.get).toBe('function');
    expect(typeof capturedCache.clear).toBe('function');
  });

  it('clears the cache when response finishes', () => {
    const res = mockRes();
    let cacheRef;

    requestCacheMiddleware({}, res, () => {
      cacheRef = getRequestCache();
    });

    expect(finishCallback).toBeDefined();
    expect(typeof cacheRef.clear).toBe('function');
    // Simulate finish event - cache should be cleared
    finishCallback();
    // getRequestCache returns null after clear since the store is gone
    expect(getRequestCache()).toBeNull();
  });
});
