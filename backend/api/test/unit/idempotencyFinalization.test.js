import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
vi.mock('../../src/config/db.js', () => ({ redisClient: mocks.redis }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
import { requireIdempotency } from '../../src/middleware/idempotency.js';

let owner, settleCache, cacheWritten, events;
const flush = () => new Promise((resolve) => setImmediate(resolve));
async function fixture(status = 200) {
  const req = { user: { id: 'u1' }, method: 'POST', originalUrl: '/test', headers: { 'x-idempotency-key': 'fixture' } };
  const res = new EventEmitter();
  res.statusCode = status;
  res.json = vi.fn();
  const next = vi.fn();
  await requireIdempotency()(req, res, next);
  expect(next).toHaveBeenCalledOnce();
  return res;
}

describe('idempotency response finalization', () => {
  beforeEach(() => {
    owner = null;
    cacheWritten = false;
    events = [];
    mocks.redis.get.mockReset().mockImplementation(async (key) => key.endsWith(':lock') ? owner : null);
    mocks.redis.del.mockReset().mockImplementation(async () => { events.push('release'); owner = null; return 1; });
    mocks.redis.set.mockReset().mockImplementation(async (key, value, mode) => {
      if (mode === 'NX') { owner = value; return 'OK'; }
      await new Promise((resolve, reject) => { settleCache = { resolve, reject }; });
      cacheWritten = true;
      events.push('cache');
      return 'OK';
    });
  });

  it.each([['finish', 'close'], ['close', 'finish']])('serializes %s then %s until cache is durable', async (first, second) => {
    const res = await fixture();
    res.json({ success: true });
    res.emit(first);
    res.emit(second);
    await flush();
    expect(cacheWritten).toBe(false);
    expect(mocks.redis.del).not.toHaveBeenCalled();
    expect(owner).not.toBeNull();
    settleCache.resolve();
    await flush();
    expect(events).toEqual(['cache', 'release']);
    expect(mocks.redis.del).toHaveBeenCalledOnce();
  });

  it('waits for cache on close-only termination', async () => {
    const res = await fixture();
    res.json({ success: true });
    res.emit('close');
    await flush();
    expect(mocks.redis.del).not.toHaveBeenCalled();
    settleCache.resolve();
    await flush();
    expect(events).toEqual(['cache', 'release']);
  });

  it.each([200, 500])('releases uncached/non-JSON status %s exactly once', async (status) => {
    const res = await fixture(status);
    if (status === 500) res.json({ error: 'failed' });
    res.emit('finish');
    res.emit('close');
    await flush();
    expect(events).toEqual(['release']);
    expect(mocks.redis.del).toHaveBeenCalledOnce();
  });

  it('settles a rejected cache write before releasing once', async () => {
    const res = await fixture();
    res.json({ success: true });
    res.emit('finish');
    res.emit('close');
    await flush();
    expect(mocks.redis.del).not.toHaveBeenCalled();
    settleCache.reject(new Error('cache unavailable'));
    await flush();
    expect(events).toEqual(['release']);
    expect(mocks.redis.del).toHaveBeenCalledOnce();
  });

  it('does not release a different owner after finalization', async () => {
    const res = await fixture();
    res.json({ success: true });
    res.emit('finish');
    res.emit('close');
    owner = 'new-owner';
    settleCache.resolve();
    await flush();
    expect(mocks.redis.del).not.toHaveBeenCalled();
    expect(owner).toBe('new-owner');
  });
});

// A ServerResponse double that behaves like Node's: `writableEnded` flips to
// true when the handler calls end(), and res.json() funnels through end() just
// like Express. This lets us model a client socket that dies *while the handler
// is still running*, which emits `close` but never `finish`.
async function abortableFixture(status = 200) {
  const req = { user: { id: 'u1' }, method: 'POST', originalUrl: '/wallet/withdraw', headers: { 'x-idempotency-key': 'abort-key' } };
  const res = new EventEmitter();
  res.statusCode = status;
  res.writableEnded = false;
  res.end = vi.fn(function end() { this.writableEnded = true; return this; });
  res.json = vi.fn(function json(body) { return this.end(JSON.stringify(body)); });
  const next = vi.fn();
  await requireIdempotency()(req, res, next);
  expect(next).toHaveBeenCalledOnce();
  return res;
}

describe('client disconnects while the handler is still running', () => {
  beforeEach(() => {
    owner = null;
    events = [];
    mocks.redis.get.mockReset().mockImplementation(async (key) => key.endsWith(':lock') ? owner : null);
    mocks.redis.del.mockReset().mockImplementation(async () => { events.push('release'); owner = null; return 1; });
    mocks.redis.set.mockReset().mockImplementation(async (key, value, mode) => {
      if (mode === 'NX') { owner = value; return 'OK'; }
      await new Promise((resolve, reject) => { settleCache = { resolve, reject }; });
      events.push('cache');
      return 'OK';
    });
    delete mocks.redis.eval;
  });

  it('keeps holding the lock on close-before-end so a retry cannot re-enter the handler', async () => {
    const res = await abortableFixture();
    res.emit('close'); // socket died; handler has NOT responded yet
    await flush();
    expect(mocks.redis.del).not.toHaveBeenCalled();
    expect(owner).not.toBeNull();
  });

  it('caches the late response and only then releases the lock', async () => {
    const res = await abortableFixture();
    res.emit('close');
    res.json({ success: true }); // handler completes after the client left; no `finish` will ever fire
    await flush();
    expect(mocks.redis.del).not.toHaveBeenCalled(); // still waiting for the cache write
    settleCache.resolve();
    await flush();
    expect(events).toEqual(['cache', 'release']);
    expect(mocks.redis.del).toHaveBeenCalledOnce();
  });

  it('releases the lock (without caching) when the handler fails after the client left', async () => {
    const res = await abortableFixture(500);
    res.emit('close');
    res.json({ error: 'failed' });
    await flush();
    expect(events).toEqual(['release']);
    expect(mocks.redis.del).toHaveBeenCalledOnce();
  });

  it('still finalizes immediately when close arrives after the handler already ended the response', async () => {
    const res = await abortableFixture(500);
    res.json({ error: 'failed' }); // writableEnded = true, then the socket closes before flush
    res.emit('close');
    await flush();
    expect(events).toEqual(['release']);
    expect(mocks.redis.del).toHaveBeenCalledOnce();
  });

  it('releases the lock via a watchdog if the handler never responds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const res = await abortableFixture();
      res.emit('close');
      await vi.advanceTimersByTimeAsync(119_000);
      expect(mocks.redis.del).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2_000); // past the 120s lock TTL
      expect(mocks.redis.del).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases the lock with an atomic owner-checked script when the client supports EVAL', async () => {
    mocks.redis.eval = vi.fn().mockResolvedValue(1);
    try {
      const res = await abortableFixture(500);
      res.json({ error: 'failed' });
      res.emit('finish');
      await flush();
      expect(mocks.redis.eval).toHaveBeenCalledOnce();
      const [script, numKeys, lockKey, lockValue] = mocks.redis.eval.mock.calls[0];
      expect(script).toContain("redis.call('GET', KEYS[1]) == ARGV[1]");
      expect(numKeys).toBe(1);
      expect(lockKey.endsWith(':lock')).toBe(true);
      expect(lockValue).toBe(owner);
      expect(mocks.redis.del).not.toHaveBeenCalled(); // no non-atomic GET+DEL
    } finally {
      delete mocks.redis.eval;
    }
  });
});
