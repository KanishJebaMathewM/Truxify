import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireIdempotency } from '../../src/middleware/idempotency.js';

const mockRedisRef = vi.hoisted(() => {
  const mock = { get: vi.fn(), set: vi.fn() };
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
  mockRedisRef.mock.get.mockReset();
  mockRedisRef.mock.set.mockReset();
  mockRedisRef.current = mockRedisRef.mock;
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

  it('calls next on cache miss (Redis available)', async () => {
    const middleware = requireIdempotency();
    const req = makeReq({ headers: { 'x-idempotency-key': 'key-abc' } });
    const res = makeRes();
    const next = makeNext();

    mockRedisRef.mock.get.mockResolvedValue(null);

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
    const [cacheKey, cacheData] = mockRedisRef.mock.set.mock.calls[0];
    expect(cacheKey).toBe('idempotency:user-1:key-def');
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

    const req = makeReq({ headers: { 'x-idempotency-key': 'non-cacheable-key' } });
    const res = makeRes({ statusCode });
    const next = makeNext();

    await middleware(req, res, next);
    res.json({ error: 'some error' });

    expect(mockRedisRef.mock.set).not.toHaveBeenCalled();
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

  it('uses correct cache key format idempotency:{userId}:{key}', async () => {
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

    const [cacheKey] = mockRedisRef.mock.set.mock.calls[0];
    expect(cacheKey).toBe('idempotency:driver-42:my-unique-key-123');
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

    const [cacheKey] = mockRedisRef.mock.set.mock.calls[0];
    expect(cacheKey).toBe('idempotency:anonymous:anon-key');
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
});
