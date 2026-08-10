/**
 * Unit tests for backend/api/src/lib/requestContext.js
 */
import { describe, it, expect, vi } from 'vitest';
import { requestContext, getRequestCache } from '../../src/lib/requestContext.js';
import { RequestCache } from '../../src/lib/requestCache.js';

describe('requestContext', () => {
  describe('getRequestCache', () => {
    it('returns null when called outside a request context', () => {
      const cache = getRequestCache();
      expect(cache).toBeNull();
    });

    it('returns the requestCache from the store when inside context.run()', () => {
      const store = { requestCache: new RequestCache() };
      let observedCache = null;

      requestContext.run(store, () => {
        observedCache = getRequestCache();
      });

      expect(observedCache).toBe(store.requestCache);
      expect(observedCache).toBeInstanceOf(RequestCache);
    });

    it('returns null when the store has no requestCache property', () => {
      const store = {};
      let observedCache = null;

      requestContext.run(store, () => {
        observedCache = getRequestCache();
      });

      expect(observedCache).toBeNull();
    });

    it('returns null when the store.requestCache is explicitly null', () => {
      const store = { requestCache: null };
      let observedCache = null;

      requestContext.run(store, () => {
        observedCache = getRequestCache();
      });

      expect(observedCache).toBeNull();
    });

    it('nested context.run() calls create isolated stores', () => {
      const outerStore = { requestCache: new RequestCache() };
      const innerStore = { requestCache: new RequestCache() };
      let outerCache = null;
      let innerCache = null;
      let outerCacheAfterInner = null;

      requestContext.run(outerStore, () => {
        outerCache = getRequestCache();

        requestContext.run(innerStore, () => {
          innerCache = getRequestCache();
        });

        outerCacheAfterInner = getRequestCache();
      });

      expect(outerCache).toBe(outerStore.requestCache);
      expect(innerCache).toBe(innerStore.requestCache);
      expect(outerCacheAfterInner).toBe(outerStore.requestCache);
    });
  });
});
