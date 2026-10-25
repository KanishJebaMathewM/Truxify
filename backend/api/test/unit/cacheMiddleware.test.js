import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

let mockGet = vi.fn();
let mockSet = vi.fn();

vi.mock('../../src/config/db.js', () => ({
  upstashRedisClient: {
    get: (...args) => mockGet(...args),
    set: (...args) => mockSet(...args),
  },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { cacheMiddleware } = await import('../../src/middleware/cacheMiddleware.js');

function buildApp(keyGenerator) {
  const reached = vi.fn();
  const app = express();
  app.use(cacheMiddleware(30, 'test-prefix', keyGenerator));
  app.get('/', (req, res) => {
    reached();
    res.json({ ok: true });
  });
  return { app, reached };
}

describe('cacheMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(null);
    mockSet.mockResolvedValue('OK');
  });

  it('bypasses the cache and calls next() when key generation throws', async () => {
    const { app, reached } = buildApp(() => {
      throw new Error('boom');
    });

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(reached).toHaveBeenCalledTimes(1);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('serves a cache hit without invoking the handler', async () => {
    mockGet.mockResolvedValue({ cached: 'payload' });
    const { app, reached } = buildApp(() => 'key-1');

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.headers['x-cache']).toBe('HIT');
    expect(res.body).toEqual({ cached: 'payload' });
    expect(reached).not.toHaveBeenCalled();
  });

  it('writes the handler response to the cache on a miss', async () => {
    const { app, reached } = buildApp(() => 'key-2');

    const res = await request(app).get('/');

    expect(res.headers['x-cache']).toBe('MISS');
    expect(reached).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      'cache:test-prefix:key-2',
      { ok: true },
      { ex: 30 },
    );
  });
});