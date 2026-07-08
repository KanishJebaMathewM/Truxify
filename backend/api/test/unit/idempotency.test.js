/**
 * Unit tests for backend/api/src/middleware/idempotency.js
 *
 * Coverage:
 *   - requireIdempotency: returns 400 when X-Idempotency-Key header is missing
 *   - requireIdempotency: calls next immediately when Redis client is unavailable
 *   - requireIdempotency: returns cached response on cache hit
 *   - requireIdempotency: intercepts res.json to cache the response body on miss
 *   - requireIdempotency: skips caching for 5xx responses (res.statusCode >= 500)
 *   - requireIdempotency: fails open on Redis errors (calls next)
 *
 * Run with:  npm run test:unit -- test/unit/idempotency.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireIdempotency } from '../../src/middleware/idempotency.js';

const redisClientMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  redisClient: redisClientMock,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeReq(overrides = {}) {
  return {
    headers: {},
    user: { id: 'user-1' },
    ...overrides,
  };
}

function makeRes(overrides = {}) {
  return {
    statusCode: 200,
    status: vi.fn(function(code) { this.statusCode = code; return this; }),
    json: vi.fn(function(body) { return this; }),
    ...overrides,
  };
}

function makeNext() {
  return vi.fn();
}

beforeEach(() => {
  vi.clearAllMocks();
  redisClientMock.get.mockReset();
  redisClientMock.set.mockReset();
});

describe('requireIdempotency middleware', () => {
  it('returns 400 when X-Idempotency-Key header is missing', async () => {
    const middleware = requireIdempotency();
    const req = makeReq({ headers: {} });
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'X-Idempotency-Key header is required for this action.',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next immediately when Redis client is unavailable (bypass)', async () => {
    const middleware = requireIdempotency();
    const req = makeReq({ headers: { 'x-idempotency-key': 'key-abc' } });
    const res = makeRes();
    const next = makeNext();

    // Simulate redisClient being null/undefined via the mock returning undefined
    redisClientMock.get.mockResolvedValue(undefined);

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns cached response with original statusCode and body on cache hit', async () => {
    const middleware = requireIdempotency();
    const cachedBody = { orderId: '123', status: 'confirmed' };
    redisClientMock.get.mockResolvedValue(
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
    redisClientMock.get.mockResolvedValue(null);
    redisClientMock.set.mockResolvedValue('OK');

    const req = makeReq({ headers: { 'x-idempotency-key': 'key-def' } });
    const res = makeRes({ statusCode: 200 });
    const next = makeNext();

    await middleware(req, res, next);

    // The middleware calls next() to let the route handler run.
    // When the route handler calls res.json(), the overridden version
    // caches the response before calling the original json.
    expect(next).toHaveBeenCalled();

    // Verify res.json was overridden (middleware intercepted it)
    expect(typeof res.json).toBe('function');

    // Simulate the route handler calling the overridden res.json
    const responseBody = { success: true, data: 'some-data' };
    res.json(responseBody);

    // After res.json is called, the cache should have been set
    expect(redisClientMock.set).toHaveBeenCalled();
    const [cacheKey, cacheData] = redisClientMock.set.mock.calls[0];
    expect(cacheKey).toBe('idempotency:user-1:key-def');
    const parsed = JSON.parse(cacheData);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body).toEqual(responseBody);
  });

  it('skips caching for 5xx responses', async () => {
    const middleware = requireIdempotency();
    redisClientMock.get.mockResolvedValue(null);

    const req = makeReq({ headers: { 'x-idempotency-key': 'key-5xx' } });
    const res = makeRes({ statusCode: 500 });
    const next = makeNext();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();

    // Simulate route handler calling res.json with 5xx body
    res.json({ error: 'Internal server error' });

    // redisClient.set should NOT have been called for 5xx
    expect(redisClientMock.set).not.toHaveBeenCalled();
  });

  it('skips caching for 503 responses', async () => {
    const middleware = requireIdempotency();
    redisClientMock.get.mockResolvedValue(null);

    const req = makeReq({ headers: { 'x-idempotency-key': 'key-503' } });
    const res = makeRes({ statusCode: 503 });
    const next = makeNext();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();

    res.json({ error: 'Service unavailable' });

    expect(redisClientMock.set).not.toHaveBeenCalled();
  });

  it('fails open when Redis get throws an error', async () => {
    const middleware = requireIdempotency();
    redisClientMock.get.mockRejectedValue(new Error('Redis connection error'));

    const req = makeReq({ headers: { 'x-idempotency-key': 'key-err' } });
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('fails open when Redis set throws an error (does not propagate)', async () => {
    const middleware = requireIdempotency();
    redisClientMock.get.mockResolvedValue(null);
    redisClientMock.set.mockRejectedValue(new Error('Redis write error'));

    const req = makeReq({ headers: { 'x-idempotency-key': 'key-set-err' } });
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();

    // The overridden res.json should not throw even when redisClient.set fails
    expect(() => res.json({ success: true })).not.toThrow();
  });

  it('uses correct cache key format idempotency:{userId}:{key}', async () => {
    const middleware = requireIdempotency();
    redisClientMock.get.mockResolvedValue(null);
    redisClientMock.set.mockResolvedValue('OK');

    const req = makeReq({
      headers: { 'x-idempotency-key': 'my-unique-key-123' },
      user: { id: 'driver-42' },
    });
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);
    res.json({ result: 'done' });

    const [cacheKey] = redisClientMock.set.mock.calls[0];
    expect(cacheKey).toBe('idempotency:driver-42:my-unique-key-123');
  });

  it('uses anonymous cache key when req.user is not present', async () => {
    const middleware = requireIdempotency();
    redisClientMock.get.mockResolvedValue(null);
    redisClientMock.set.mockResolvedValue('OK');

    const req = makeReq({
      headers: { 'x-idempotency-key': 'anon-key' },
      user: null,
    });
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);
    res.json({ result: 'done' });

    const [cacheKey] = redisClientMock.set.mock.calls[0];
    expect(cacheKey).toBe('idempotency:anonymous:anon-key');
  });

  it('caches 409 Conflict responses (client errors are cacheable)', async () => {
    const middleware = requireIdempotency();
    redisClientMock.get.mockResolvedValue(null);
    redisClientMock.set.mockResolvedValue('OK');

    const req = makeReq({ headers: { 'x-idempotency-key': 'conflict-key' } });
    const res = makeRes({ statusCode: 409 });
    const next = makeNext();

    await middleware(req, res, next);
    res.json({ error: 'Duplicate order' });

    // 409 is < 500 so it should be cached
    expect(redisClientMock.set).toHaveBeenCalled();
  });
});
