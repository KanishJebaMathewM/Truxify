/**
 * Unit tests for backend/api/src/middleware/rateLimiter.js
 *
 * Regression test for issue #11213: once promoted, the DeferredRedisStore
 * returned its (possibly dead) Redis store on every request and never fell back
 * to the in-memory store, so a dead Redis after startup promotion silently
 * disabled rate limiting for the life of the process. A failed promotion also
 * latched `redisInitFailed` permanently, so even after Redis recovered the
 * limiter stayed on the in-memory store.
 *
 * Coverage:
 *   - before Redis is ready, the in-memory store is used (no promotion).
 *   - once Redis is ready the store promotes to Redis.
 *   - if Redis dies after promotion, the store degrades to in-memory.
 *   - when Redis recovers, the store re-promotes to Redis.
 *   - a latched redisInitFailed is not permanent: after the cooldown elapses
 *     it re-promotes instead of staying stuck on the in-memory store.
 *
 * Run with:  npm test -- test/unit/deferredRedisStore.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const redisState = { status: 'end' };
const redisClient = {
  get status() {
    return redisState.status;
  },
  call: vi.fn().mockResolvedValue('OK'),
};

vi.mock('../../src/config/db.js', () => ({ redisClient }));

const { __testing } = await import('../../src/middleware/rateLimiter.js');
const { DeferredRedisStore, isRedisReady } = __testing;

describe('DeferredRedisStore (issue #11213)', () => {
  beforeEach(() => {
    redisState.status = 'end';
    redisClient.call.mockReset();
    redisClient.call.mockResolvedValue('OK');
  });

  it('uses the in-memory store before Redis is ready', () => {
    const store = new DeferredRedisStore('rl:test:');
    store.init({});
    expect(isRedisReady()).toBe(false);
    expect(store.activeStore()).toBe(store.memoryStore);
    expect(store.redisStore).toBeNull();
  });

  it('promotes to a Redis-backed store once Redis is ready', () => {
    redisState.status = 'ready';
    const store = new DeferredRedisStore('rl:test:');
    store.init({});
    const active = store.activeStore();
    expect(active).not.toBe(store.memoryStore);
    expect(store.redisStore).not.toBeNull();
    expect(store.redisStore).toBe(active);
  });

  it('degrades to in-memory when Redis dies after promotion', () => {
    redisState.status = 'ready';
    const store = new DeferredRedisStore('rl:test:');
    store.init({});
    expect(store.activeStore()).toBe(store.redisStore);

    redisState.status = 'end';
    expect(store.activeStore()).toBe(store.memoryStore);
  });

  it('re-promotes to Redis when it recovers after a degradation', () => {
    const store = new DeferredRedisStore('rl:test:');
    store.init({});

    redisState.status = 'ready';
    expect(store.activeStore()).toBe(store.redisStore);

    redisState.status = 'end';
    expect(store.activeStore()).toBe(store.memoryStore);

    redisState.status = 'ready';
    expect(store.activeStore()).toBe(store.redisStore);
  });

  it('re-promotes after a latched failure once the cooldown has elapsed', () => {
    redisState.status = 'ready';
    const store = new DeferredRedisStore('rl:test:');
    store.init({});

    // Simulate a previously latched promotion failure (e.g. transient init
    // error) within the cooldown window: must stay on the in-memory store.
    store.redisStore = null;
    store.redisInitFailed = true;
    store.lastRedisAttempt = Date.now();
    expect(store.activeStore()).toBe(store.memoryStore);

    // Cooldown elapsed: the next attempt must re-promote to Redis rather than
    // staying permanently stuck on the in-memory store.
    store.lastRedisAttempt = 0;
    const active = store.activeStore();
    expect(active).not.toBe(store.memoryStore);
    expect(store.redisStore).not.toBeNull();
    expect(store.redisInitFailed).toBe(false);
    expect(store.activeStore()).toBe(store.redisStore);
  });
});
