import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireIdempotency } from '../../src/middleware/idempotency.js';

// Self-contained fake Redis that lets us control when the cache write lands
// and whether a lock is currently held, so we can prove the lock is held
// until the cache write is durable (#11451).
const mockRedisRef = vi.hoisted(() => {
  const store = new Map();
  let lockAcquired = false;
  const mock = {
    store,
    setLockAcquiredFalse: () => { lockAcquired = false; },
    get: vi.fn((key) => Promise.resolve(store.has(key) ? store.get(key) : null)),
    set: vi.fn((key, value, mode, ...rest) => {
      if (key.endsWith(':lock')) {
        // First lock acquisition succeeds; later ones fail (NX semantics).
        if (!lockAcquired) {
          lockAcquired = true;
          store.set(key, '1');
          return Promise.resolve('OK');
        }
        return Promise.resolve(null);
      }
      // Cache write: only "lands" once the caller resolves `cacheResolve`.
      return cacheControl.promise.then(() => {
        store.set(key, value);
        return 'OK';
      });
    }),
    del: vi.fn((key) => {
      store.delete(key);
      if (key.endsWith(':lock')) lockAcquired = false;
      return Promise.resolve(1);
    }),
  };
  const cacheControl = { promise: null, resolve: null };
  cacheControl.promise = new Promise((resolve) => { cacheControl.resolve = resolve; });
  return { mock, store, cacheControl };
});

vi.mock('../../src/config/db.js', () => ({
  get redisClient() { return mockRedisRef.mock; },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeReq(overrides = {}) {
  return {
    headers: {},
    method: 'POST',
    originalUrl: '/orders',
    user: { id: 'user-1' },
    ...overrides,
  };
}

function makeRes(overrides = {}) {
  return {
    statusCode: 200,
    status: vi.fn(function (code) { this.statusCode = code; return this; }),
    json: vi.fn(function (body) { return this; }),
    once: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRedisRef.store.clear();
  mockRedisRef.mock.setLockAcquiredFalse();
  // Reset the delayed cache write to a fresh, unresolved promise each test.
  mockRedisRef.cacheControl.promise = new Promise((resolve) => {
    mockRedisRef.cacheControl.resolve = resolve;
  });
});

describe('idempotency lock ordering (#11451)', () => {
  it('holds the lock until the cache write is durable so a duplicate is collapsed', async () => {
    vi.useFakeTimers();
    try {
      const middleware = requireIdempotency();

      // --- Request A: acquires lock, runs handler, cache write still pending ---
      const reqA = makeReq({ headers: { 'x-idempotency-key': 'concurrent-key' } });
      let handlerACalled = false;
      const resA = makeRes();
      const nextA = vi.fn(() => { handlerACalled = true; resA.json({ ok: true }); });
      const promiseA = middleware(reqA, resA, nextA);
      await vi.advanceTimersByTimeAsync(0);
      await promiseA;
      expect(handlerACalled).toBe(true);

      // Grab the 'finish' handler the middleware registered to release the lock.
      const finishHandler = resA.once.mock.calls.find(([event]) => event === 'finish')[1];
      expect(typeof finishHandler).toBe('function');

      // --- Request B: arrives while A holds the lock and cache is not yet written ---
      let handlerBCalled = false;
      const reqB = makeReq({ headers: { 'x-idempotency-key': 'concurrent-key' } });
      const resB = makeRes();
      const nextB = vi.fn(() => { handlerBCalled = true; resB.json({ ok: true }); });
      const promiseB = middleware(reqB, resB, nextB);

      // Let B poll: it must NOT re-execute the handler while the lock is held.
      await vi.advanceTimersByTimeAsync(5 * 200);
      expect(handlerBCalled).toBe(false);

      // A's result is now durable and we fire the response 'finish' to release
      // the lock. The fix guarantees the cache write is awaited before the
      // lock is deleted.
      mockRedisRef.cacheControl.resolve('OK');
      await finishHandler();
      await vi.advanceTimersByTimeAsync(5 * 200);
      await promiseB;

      // B must be collapsed to the cached response, never re-executing.
      expect(handlerBCalled).toBe(false);
      expect(resB.status).toHaveBeenCalledWith(200);
      expect(resB.json).toHaveBeenCalledWith({ ok: true });
      // The lock was actually released (deleted) after the cache write landed.
      expect(mockRedisRef.mock.del).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
