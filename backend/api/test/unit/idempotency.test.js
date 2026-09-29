import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireIdempotency, releaseRedisLock, LUA_RELEASE_LOCK } from '../../src/middleware/idempotency.js';

const mockRedisRef = vi.hoisted(() => {
  const mock = { get: vi.fn(), set: vi.fn(), eval: vi.fn(), del: vi.fn() };
  return { current: mock, mock };
});

vi.mock('../../src/config/db.js', () => ({
  get redisClient() { return mockRedisRef.current; },
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
    status: vi.fn(function(code) { this.statusCode = code; return this; }),
    json: vi.fn(function(body) { return this; }),
    once: vi.fn(),
    ...overrides,
  };
}

function makeNext() {
  return vi.fn();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRedisRef.mock.get.mockReset();
  mockRedisRef.mock.set.mockReset();
  mockRedisRef.mock.eval.mockReset();
  mockRedisRef.mock.del.mockReset();
  mockRedisRef.mock.eval.mockResolvedValue(1);
  mockRedisRef.mock.del.mockResolvedValue(1);
  mockRedisRef.current = mockRedisRef.mock;
});

describe('requireIdempotency middleware', () => {
  it('returns 400 when X-Idempotency-Key header is missing', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const middleware = requireIdempotency();
    const req = makeReq({ headers: {} });
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);
    
    process.env.NODE_ENV = originalEnv;

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'X-Idempotency-Key must be a non-empty string.',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next on cache miss (Redis available)', async () => {
    const middleware = requireIdempotency();
    const req = makeReq({ headers: { 'x-idempotency-key': 'key-abc' } });
    const res = makeRes();
    const next = makeNext();

    mockRedisRef.mock.get.mockResolvedValue(null);
    mockRedisRef.mock.set.mockResolvedValue('OK');

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns cached response with original statusCode and body on cache hit', async () => {
    const middleware = requireIdempotency();
    const cachedBody = { orderId: '123', status: 'confirmed' };
    mockRedisRef.mock.get.mockResolvedValue(
      JSON.stringify({ statusCode: 201, body: cachedBody })
    );

    const req = makeReq({ headers: { 'x-idempotency-key': 'key-abc' } });
    const res = makeRes({ statusCode: 201 });
    const next = makeNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(cachedBody);
    expect(next).not.toHaveBeenCalled();
  });

  it('intercepts res.json to cache the response body on cache miss', async () => {
    const middleware = requireIdempotency();
    mockRedisRef.mock.get.mockResolvedValue(null);
    mockRedisRef.mock.set.mockResolvedValue('OK');

    const req = makeReq({ headers: { 'x-idempotency-key': 'key-def' } });
    const res = makeRes({ statusCode: 200 });
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(typeof res.json).toBe('function');

    const responseBody = { success: true, data: 'some-data' };
    res.json(responseBody);

    expect(mockRedisRef.mock.set).toHaveBeenCalled();
    const [cacheKey, cacheData] = mockRedisRef.mock.set.mock.calls[1];
    expect(cacheKey).toBe('idempotency:user-1:POST:/orders:key-def');
    const parsed = JSON.parse(cacheData);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body).toEqual(responseBody);
  });

  it.each([
    [200],
    [201],
    [202],
    [204],
  ])('caches %i responses', async (statusCode) => {
    const middleware = requireIdempotency();
    mockRedisRef.mock.get.mockResolvedValue(null);
    mockRedisRef.mock.set.mockResolvedValue('OK');

    const req = makeReq({ headers: { 'x-idempotency-key': 'cacheable-key' } });
    const res = makeRes({ statusCode });
    const next = makeNext();

    await middleware(req, res, next);
    res.json({ result: 'ok' });

    expect(mockRedisRef.mock.set).toHaveBeenCalled();
  });

  it.each([
    [400],
    [401],
    [403],
    [404],
    [409],
    [422],
    [429],
    [500],
    [502],
    [503],
  ])('does NOT cache %i responses', async (statusCode) => {
    const middleware = requireIdempotency();
    mockRedisRef.mock.get.mockResolvedValue(null);
    mockRedisRef.mock.set.mockResolvedValue('OK');
    const req = makeReq({ headers: { 'x-idempotency-key': 'non-cacheable-key' } });
    const res = makeRes({ statusCode });
    const next = makeNext();
    await middleware(req, res, next);
    res.json({ error: 'some error' });
    const cacheWriteCalls = mockRedisRef.mock.set.mock.calls.filter(([key]) => !key.endsWith(':lock'));
    expect(cacheWriteCalls).toHaveLength(0);
});

  it('fails open when Redis get throws an error', async () => {
    const middleware = requireIdempotency();
    mockRedisRef.mock.get.mockRejectedValue(new Error('Redis connection error'));

    const req = makeReq({ headers: { 'x-idempotency-key': 'key-err' } });
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('fails open when Redis set throws an error (does not propagate)', async () => {
    const middleware = requireIdempotency();
    mockRedisRef.mock.get.mockResolvedValue(null);
    mockRedisRef.mock.set.mockRejectedValue(new Error('Redis write error'));

    const req = makeReq({ headers: { 'x-idempotency-key': 'key-set-err' } });
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();

    expect(() => res.json({ success: true })).not.toThrow();
  });

  it('uses cache key scoped by user, method, and URL', async () => {
    const middleware = requireIdempotency();
    mockRedisRef.mock.get.mockResolvedValue(null);
    mockRedisRef.mock.set.mockResolvedValue('OK');

    const req = makeReq({
      headers: { 'x-idempotency-key': 'my-unique-key-123' },
      user: { id: 'driver-42' },
    });
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);
    res.json({ result: 'done' });

    const [cacheKey] = mockRedisRef.mock.set.mock.calls[1];
    expect(cacheKey).toBe('idempotency:driver-42:POST:/orders:my-unique-key-123');
  });

  it('uses anonymous cache key when req.user is not present', async () => {
    const middleware = requireIdempotency();
    mockRedisRef.mock.get.mockResolvedValue(null);
    mockRedisRef.mock.set.mockResolvedValue('OK');

    const req = makeReq({
      headers: { 'x-idempotency-key': 'anon-key' },
      user: null,
    });
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);
    res.json({ result: 'done' });

    const [cacheKey] = mockRedisRef.mock.set.mock.calls[1];
    expect(cacheKey).toBe('idempotency:anonymous:POST:/orders:anon-key');
  });

  it('falls back to in-memory store when redisClient is null', async () => {
    mockRedisRef.current = null;

    const middleware = requireIdempotency();
    const req = makeReq({ headers: { 'x-idempotency-key': 'mem-key' } });
    const res = makeRes({ statusCode: 200 });
    const next = makeNext();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();

    res.json({ result: 'from-memory' });

    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns in-memory cached response on repeat call when Redis is unavailable', async () => {
    mockRedisRef.current = null;

    const middleware = requireIdempotency();
    const req = makeReq({ headers: { 'x-idempotency-key': 'mem-cached' } });
    const res1 = makeRes({ statusCode: 201 });
    const res2 = makeRes();
    const next = makeNext();

    await middleware(req, res1, next);
    res1.json({ id: 'order-1' });

    await middleware(req, res2, next);
    expect(res2.status).toHaveBeenCalledWith(201);
    expect(res2.json).toHaveBeenCalledWith({ id: 'order-1' });
  });

  it('acquires the lock with a TTL that outlives the longest handler', async () => {
    const middleware = requireIdempotency();
    mockRedisRef.mock.get.mockResolvedValue(null);
    mockRedisRef.mock.set.mockResolvedValue('OK');

    const req = makeReq({ headers: { 'x-idempotency-key': 'slow-key' } });
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    const lockCall = mockRedisRef.mock.set.mock.calls.find(([key]) => key.endsWith(':lock'));
    expect(lockCall).toBeDefined();
    // Escrow handlers can wait 60s for on-chain confirmation, so the lock TTL
    // must be at least double that — a 10s lock would expire mid-handler and
    // let a duplicate re-acquire it.
    expect(lockCall[3]).toBe('PX');
    expect(lockCall[4]).toBeGreaterThanOrEqual(120000);
  });

  it('rejects a duplicate while the original slow handler still holds the lock', async () => {
    vi.useFakeTimers();
    try {
      const middleware = requireIdempotency();
      // No cached response yet, and the original request still holds the lock:
      // the lock key is present and the re-acquire attempt fails.
      mockRedisRef.mock.get.mockImplementation((key) =>
        key.endsWith(':lock') ? Promise.resolve('1') : Promise.resolve(null)
      );
      mockRedisRef.mock.set.mockResolvedValue(null);

      const req = makeReq({ headers: { 'x-idempotency-key': 'dup-key' } });
      const res = makeRes();
      const next = makeNext();

      const duplicate = middleware(req, res, next);
      // The middleware polls the lock for up to 600 x 200ms = 120s (matches
      // the lock TTL) before giving up with a 409.
      await vi.advanceTimersByTimeAsync(200 * 600 + 10);
      await duplicate;

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ error: 'Duplicate request being processed' });
      expect(next).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  describe('Redis Lock Ownership & Safe Compare-and-Delete Release', () => {
    it('stores a unique cryptographically secure UUID token as the lock value, never constant "1"', async () => {
      const middleware = requireIdempotency();
      mockRedisRef.mock.get.mockResolvedValue(null);
      mockRedisRef.mock.set.mockResolvedValue('OK');

      const req = makeReq({ headers: { 'x-idempotency-key': 'uuid-test-key' } });
      const res = makeRes();
      const next = makeNext();

      await middleware(req, res, next);

      const lockCall = mockRedisRef.mock.set.mock.calls.find(([key]) => key.endsWith(':lock'));
      expect(lockCall).toBeDefined();
      const lockValue = lockCall[1];

      // Value must NOT be constant '1'
      expect(lockValue).not.toBe('1');
      // Value must be a valid UUID v4 (36 chars: 8-4-4-4-12 hex digits)
      expect(lockValue).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('generates distinct unique tokens for separate lock acquisitions', async () => {
      const middleware = requireIdempotency();
      mockRedisRef.mock.get.mockResolvedValue(null);
      mockRedisRef.mock.set.mockResolvedValue('OK');

      const req1 = makeReq({ headers: { 'x-idempotency-key': 'req-1-key' } });
      const res1 = makeRes();
      const req2 = makeReq({ headers: { 'x-idempotency-key': 'req-2-key' } });
      const res2 = makeRes();

      await middleware(req1, res1, makeNext());
      await middleware(req2, res2, makeNext());

      const lockCalls = mockRedisRef.mock.set.mock.calls.filter(([key]) => key.endsWith(':lock'));
      expect(lockCalls).toHaveLength(2);
      const token1 = lockCalls[0][1];
      const token2 = lockCalls[1][1];

      expect(token1).not.toBe(token2);
    });

    it('passes the acquired lock token to releaseRedisLock via atomic Lua compare-and-delete on response finish', async () => {
      const middleware = requireIdempotency();
      mockRedisRef.mock.get.mockResolvedValue(null);
      mockRedisRef.mock.set.mockResolvedValue('OK');
      mockRedisRef.mock.eval.mockResolvedValue(1);

      const req = makeReq({ headers: { 'x-idempotency-key': 'finish-release-key' } });
      const res = makeRes();
      const next = makeNext();

      await middleware(req, res, next);

      const lockCall = mockRedisRef.mock.set.mock.calls.find(([key]) => key.endsWith(':lock'));
      const acquiredToken = lockCall[1];
      const lockKey = lockCall[0];

      // Grab the 'finish' listener registered by the middleware
      const finishListener = res.once.mock.calls.find(([event]) => event === 'finish')?.[1];
      expect(typeof finishListener).toBe('function');

      // Trigger response finish
      await finishListener();

      expect(mockRedisRef.mock.eval).toHaveBeenCalledWith(
        LUA_RELEASE_LOCK,
        1,
        lockKey,
        acquiredToken
      );
    });

    it('releaseRedisLock returns true when the caller holds the matching token', async () => {
      const fakeClient = {
        eval: vi.fn().mockResolvedValue(1),
      };

      const result = await releaseRedisLock(fakeClient, 'lock:resource-1', 'owner-token-123');

      expect(result).toBe(true);
      expect(fakeClient.eval).toHaveBeenCalledWith(
        LUA_RELEASE_LOCK,
        1,
        'lock:resource-1',
        'owner-token-123'
      );
    });

    it('releaseRedisLock returns false and does not release when token does not match (wrong owner)', async () => {
      const fakeClient = {
        eval: vi.fn().mockResolvedValue(0), // Lua script returns 0 when ARGV[1] != redis.call('get', KEYS[1])
      };

      const result = await releaseRedisLock(fakeClient, 'lock:resource-1', 'stale-token-abc');

      expect(result).toBe(false);
      expect(fakeClient.eval).toHaveBeenCalledWith(
        LUA_RELEASE_LOCK,
        1,
        'lock:resource-1',
        'stale-token-abc'
      );
    });

    it('prevents Request A from deleting Request B’s replacement lock after Request A’s lock expires', async () => {
      // Simulating in-memory Redis store with real Lua behavior
      const redisStore = new Map();
      const fakeClient = {
        eval: vi.fn(async (script, numKeys, key, token) => {
          if (redisStore.get(key) === token) {
            redisStore.delete(key);
            return 1;
          }
          return 0;
        }),
      };

      const lockKey = 'idempotency:user-1:POST:/orders:key:lock';
      const tokenA = 'token-req-A';
      const tokenB = 'token-req-B';

      // Request A acquired lock initially
      redisStore.set(lockKey, tokenA);

      // Lock expires and Request B acquires the replacement lock with tokenB
      redisStore.set(lockKey, tokenB);

      // Request A finishes late and attempts to release with tokenA
      const releasedByA = await releaseRedisLock(fakeClient, lockKey, tokenA);

      // Release by A must fail (returns false)
      expect(releasedByA).toBe(false);
      // Lock held by Request B MUST still exist in Redis!
      expect(redisStore.get(lockKey)).toBe(tokenB);

      // When Request B finishes, it releases with tokenB
      const releasedByB = await releaseRedisLock(fakeClient, lockKey, tokenB);
      expect(releasedByB).toBe(true);
      // Now the lock is deleted
      expect(redisStore.has(lockKey)).toBe(false);
    });

    it('updates ownership token upon re-acquisition and releases with the new token', async () => {
      vi.useFakeTimers();
      try {
        const middleware = requireIdempotency();

        // 1st acquisition attempt: lock is held by another request (returns null)
        let getCallCount = 0;
        mockRedisRef.mock.get.mockImplementation((key) => {
          if (key.endsWith(':lock')) {
            getCallCount++;
            // Lock is held for 1 poll, then clears (simulating previous request crash/release)
            return getCallCount <= 1 ? Promise.resolve('other-holder-token') : Promise.resolve(null);
          }
          return Promise.resolve(null);
        });

        // 1st SET NX fails (null), 2nd SET NX (re-acquisition) succeeds ('OK')
        mockRedisRef.mock.set
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce('OK');

        const req = makeReq({ headers: { 'x-idempotency-key': 'reacquire-key' } });
        const res = makeRes();
        const next = makeNext();

        const promise = middleware(req, res, next);
        await vi.advanceTimersByTimeAsync(200 * 3);
        await promise;

        // Next was called after successful re-acquisition
        expect(next).toHaveBeenCalled();

        // Verify two lock SET calls occurred, each with a different token
        const lockCalls = mockRedisRef.mock.set.mock.calls.filter(([key]) => key.endsWith(':lock'));
        expect(lockCalls).toHaveLength(2);
        const initialToken = lockCalls[0][1];
        const reacquiredToken = lockCalls[1][1];

        expect(initialToken).not.toBe(reacquiredToken);
        expect(reacquiredToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

        // When response finishes, the release must use the REACQUIRED token!
        const finishListener = res.once.mock.calls.find(([event]) => event === 'finish')?.[1];
        expect(typeof finishListener).toBe('function');

        await finishListener();

        expect(mockRedisRef.mock.eval).toHaveBeenCalledWith(
          LUA_RELEASE_LOCK,
          1,
          lockCalls[1][0],
          reacquiredToken
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('gracefully catches eval errors during lock release without crashing', async () => {
      const fakeClient = {
        eval: vi.fn().mockRejectedValue(new Error('Redis EVAL cluster failure')),
      };

      const result = await releaseRedisLock(fakeClient, 'lock:key', 'token-123');

      expect(result).toBe(false);
    });

    it('only releases lock once even if both finish and close events fire', async () => {
      const middleware = requireIdempotency();
      mockRedisRef.mock.get.mockResolvedValue(null);
      mockRedisRef.mock.set.mockResolvedValue('OK');

      const req = makeReq({ headers: { 'x-idempotency-key': 'double-event-key' } });
      const res = makeRes();
      const next = makeNext();

      await middleware(req, res, next);

      const finishListener = res.once.mock.calls.find(([event]) => event === 'finish')?.[1];
      const closeListener = res.once.mock.calls.find(([event]) => event === 'close')?.[1];

      await finishListener();
      await closeListener();

      expect(mockRedisRef.mock.eval).toHaveBeenCalledTimes(1);
    });
  });
});
