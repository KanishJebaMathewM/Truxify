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
