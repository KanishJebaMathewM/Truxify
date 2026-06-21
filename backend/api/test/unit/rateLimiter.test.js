import { describe, it, expect, vi, beforeEach } from 'vitest';

const redisClientMock = { status: 'connecting', call: vi.fn() };

vi.mock('../../src/config/db.js', () => ({
  redisClient: redisClientMock,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const redisStoreInit = vi.fn();
const redisStoreCtor = vi.fn(function () {
  this.init = redisStoreInit;
  this.increment = vi.fn().mockResolvedValue({ totalHits: 1, resetTime: undefined });
  this.__isRedisStore = true;
});

vi.mock('rate-limit-redis', () => ({
  RedisStore: redisStoreCtor,
}));

const { __testing } = await import('../../src/middleware/rateLimiter.js');
const { DeferredRedisStore } = __testing;

describe('DeferredRedisStore', () => {
  beforeEach(() => {
    redisClientMock.status = 'connecting';
    redisStoreCtor.mockClear();
    redisStoreInit.mockClear();
  });

  it('serves from the in-memory fallback while Redis is not ready', async () => {
    const store = new DeferredRedisStore('rl:test:');
    store.init({ windowMs: 1000 });

    const result = await store.increment('client-a');

    expect(redisStoreCtor).not.toHaveBeenCalled();
    expect(result.totalHits).toBe(1);
  });

  it('promotes to a RedisStore once Redis becomes ready', async () => {
    const store = new DeferredRedisStore('rl:test:');
    store.init({ windowMs: 1000 });

    await store.increment('client-a'); // memory fallback
    expect(redisStoreCtor).not.toHaveBeenCalled();

    redisClientMock.status = 'ready';
    await store.increment('client-a'); // should promote

    expect(redisStoreCtor).toHaveBeenCalledTimes(1);
    expect(redisStoreInit).toHaveBeenCalledWith({ windowMs: 1000 });
  });

  it('reuses the same RedisStore instance across requests', async () => {
    const store = new DeferredRedisStore('rl:test:');
    store.init({ windowMs: 1000 });
    redisClientMock.status = 'ready';

    await store.increment('client-a');
    await store.increment('client-b');

    expect(redisStoreCtor).toHaveBeenCalledTimes(1);
  });

  it('falls back to memory and does not retry if RedisStore construction throws', async () => {
    redisStoreCtor.mockImplementationOnce(() => { throw new Error('boom'); });
    const store = new DeferredRedisStore('rl:test:');
    store.init({ windowMs: 1000 });
    redisClientMock.status = 'ready';

    const result = await store.increment('client-a');
    expect(result.totalHits).toBe(1); // memory store answered

    await store.increment('client-a');
    expect(redisStoreCtor).toHaveBeenCalledTimes(1); // not retried
  });
});
