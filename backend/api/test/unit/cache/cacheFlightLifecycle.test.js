import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const control = vi.hoisted(() => ({ acquire: null, release: null, order: [] }));
vi.mock('../../../src/config/db.js', () => ({ redisClient: null }));
vi.mock('../../../src/middleware/logger.js', () => ({ default: { error() {}, warn() {} } }));
vi.mock('../../../src/lib/redisLock.js', () => ({
  acquireDistributedLock: (...args) => control.acquire(...args),
}));
import { StampedeLock } from '../../../src/lib/cache/StampedeLock.js';
import { MultiTierCache } from '../../../src/lib/cache/MultiTierCache.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function redisFixture() {
  const rows = new Map();
  return {
    get: vi.fn(async key => rows.get(key) ?? null),
    set: vi.fn(async (key, value) => { control.order.push('publish'); rows.set(key, value); return 'OK'; }),
    del: vi.fn(async key => rows.delete(key)),
  };
}
beforeEach(() => {
  control.order = [];
  control.release = vi.fn(async () => { control.order.push('release'); });
  control.acquire = vi.fn(async () => ({ acquired: true, release: control.release }));
});
afterEach(() => vi.useRealTimers());

describe('StampedeLock shared lifecycle', () => {
  it('40 failed shared callers receive one error without implicit retries', async () => {
    const lock = new StampedeLock(), gate = deferred(), error = new Error('compute failed');
    const compute = vi.fn(() => gate.promise);
    const pending = Array.from({ length: 40 }, () => lock.execute('board', compute));
    const outcomes = Promise.allSettled(pending);
    await tick(); gate.reject(error);
    const results = await outcomes;
    expect(results.every(result => result.status === 'rejected' && result.reason === error)).toBe(true);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(control.acquire).toHaveBeenCalledTimes(1);
    expect(control.release).toHaveBeenCalledTimes(1);
    await expect(lock.execute('board', async () => 'retry')).resolves.toMatchObject({ value: 'retry', isLeader: true });
  });

  it('success has one leader and all shared followers receive the result', async () => {
    const lock = new StampedeLock(), gate = deferred();
    const compute = vi.fn(() => gate.promise);
    const pending = Array.from({ length: 20 }, () => lock.execute('board', compute));
    await tick(); gate.resolve(7);
    const results = await Promise.all(pending);
    expect(results.filter(result => result.isLeader)).toHaveLength(1);
    expect(results.every(result => result.value === 7)).toBe(true);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('old completion after clear cannot delete a replacement flight', async () => {
    const lock = new StampedeLock(), first = deferred(), second = deferred();
    const old = lock.execute('board', () => first.promise);
    await tick(); lock.clear();
    const current = lock.execute('board', () => second.promise);
    await tick(); first.resolve('old'); await old;
    const unexpected = vi.fn(async () => 'unexpected');
    const shared = lock.execute('board', unexpected);
    second.resolve('current');
    expect((await current).value).toBe('current');
    expect((await shared).value).toBe('current');
    expect(unexpected).not.toHaveBeenCalled();
  });

  it('acquisition failure is shared and a later call retries', async () => {
    const lock = new StampedeLock(), gate = deferred(), error = new Error('acquisition failed');
    control.acquire.mockImplementationOnce(() => gate.promise);
    const compute = vi.fn(async () => 1);
    const pending = Promise.allSettled(Array.from({ length: 12 }, () => lock.execute('board', compute)));
    await tick(); gate.reject(error);
    expect((await pending).every(result => result.reason === error)).toBe(true);
    expect(control.acquire).toHaveBeenCalledTimes(1);
    expect(compute).not.toHaveBeenCalled();
    await lock.execute('board', compute);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('release failure does not hide a successful result', async () => {
    control.release.mockRejectedValue(new Error('release failed'));
    await expect(new StampedeLock().execute('board', async () => 7)).resolves.toMatchObject({ value: 7 });
  });
});

describe('MultiTierCache complete compute/publication flights', () => {
  it('publishes before releasing the acquired lock', async () => {
    const cache = new MultiTierCache({ redisClient: redisFixture() });
    expect(await cache.fetch('board', async () => { control.order.push('compute'); return 7; })).toBe(7);
    expect(control.order).toEqual(['compute', 'publish', 'release']);
  });

  it('blocked publication remains owned by one flight and lock', async () => {
    const redis = redisFixture(), gate = deferred(), entered = deferred();
    redis.set.mockImplementation(async () => { entered.resolve(); await gate.promise; return 'OK'; });
    const cache = new MultiTierCache({ redisClient: redis });
    const compute = vi.fn(async () => 7);
    const first = cache._computeAndSet('board', compute);
    await entered.promise;
    const others = Array.from({ length: 20 }, () => cache._computeAndSet('mtc:board', compute));
    await tick();
    expect(control.release).not.toHaveBeenCalled();
    expect(compute).toHaveBeenCalledTimes(1);
    gate.resolve();
    expect(await Promise.all([first, ...others])).toEqual(Array(21).fill(7));
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(control.release).toHaveBeenCalledTimes(1);
  });

  it('foreground and background refresh share one current computation', async () => {
    const cache = new MultiTierCache({ redisClient: redisFixture() }), gate = deferred();
    const compute = vi.fn(() => gate.promise);
    const foreground = cache._computeAndSet('board', compute);
    cache._triggerBackgroundRecompute('mtc:board', compute, {});
    await tick(); await tick();
    expect(compute).toHaveBeenCalledTimes(1);
    gate.resolve(7); await foreground; await tick();
    expect(control.acquire).toHaveBeenCalledTimes(1);
  });

  it('40 contended misses share one emergency compute and publication', async () => {
    vi.useFakeTimers();
    control.acquire.mockResolvedValue({ acquired: false, release: control.release });
    const redis = redisFixture(), cache = new MultiTierCache({ redisClient: redis });
    const compute = vi.fn(async () => 7);
    const pending = Array.from({ length: 40 }, () => cache.fetch('board', compute));
    await vi.advanceTimersByTimeAsync(300);
    expect(await Promise.all(pending)).toEqual(Array(40).fill(7));
    expect(compute).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(control.acquire).toHaveBeenCalledTimes(1);
  });

  it('fallback computation failures are shared and a later caller can retry', async () => {
    vi.useFakeTimers();
    control.acquire.mockResolvedValue({ acquired: false, release: control.release });
    const cache = new MultiTierCache({ redisClient: redisFixture() }), error = new Error('fallback failed');
    const compute = vi.fn(async () => { throw error; });
    const outcomes = Promise.allSettled(Array.from({ length: 20 }, () => cache.fetch('board', compute)));
    await vi.advanceTimersByTimeAsync(300);
    expect((await outcomes).every(result => result.reason === error)).toBe(true);
    expect(compute).toHaveBeenCalledTimes(1);
    control.acquire.mockResolvedValue({ acquired: true, release: control.release });
    await expect(cache.fetch('board', async () => 8)).resolves.toBe(8);
  });

  for (const value of [null, undefined, false, 0]) {
    it(`computed ${String(value)} is shared without implicit extra computation`, async () => {
      const cache = new MultiTierCache({ redisClient: redisFixture() }), gate = deferred();
      const compute = vi.fn(() => gate.promise);
      const pending = Array.from({ length: 20 }, () => cache.fetch('board', compute));
      await tick(); gate.resolve(value);
      expect(await Promise.all(pending)).toEqual(Array(20).fill(value));
      expect(compute).toHaveBeenCalledTimes(1);
    });
  }

  it('Redis publication failure retains L1 fallback and releases the lock', async () => {
    const redis = redisFixture(); redis.set.mockRejectedValue(new Error('Redis unavailable'));
    const cache = new MultiTierCache({ redisClient: redis });
    await expect(cache.fetch('board', async () => 7)).resolves.toBe(7);
    expect(await cache.get('board')).toBe(7);
    expect(control.release).toHaveBeenCalledTimes(1);
  });

  it('thrown publication errors release ownership and permit a later retry', async () => {
    const cache = new MultiTierCache({ redisClient: redisFixture() }), error = new Error('publication failed');
    vi.spyOn(cache, 'set').mockRejectedValueOnce(error);
    await expect(cache.fetch('board', async () => 7)).rejects.toBe(error);
    expect(control.release).toHaveBeenCalledTimes(1);
    await expect(cache.fetch('board', async () => 8)).resolves.toBe(8);
  });

  it('another instance publishing during contention avoids emergency computation', async () => {
    vi.useFakeTimers();
    control.acquire.mockResolvedValue({ acquired: false, release: control.release });
    const redis = redisFixture(), cache = new MultiTierCache({ redisClient: redis });
    redis.get.mockResolvedValueOnce(null).mockImplementation(async () =>
      JSON.stringify({ v: 11, e: Date.now() + 10000, d: 1, t: 10 }));
    const compute = vi.fn(async () => 7);
    const pending = cache.fetch('board', compute);
    await vi.advanceTimersByTimeAsync(300);
    expect(await pending).toBe(11);
    expect(compute).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('XFetch delta and computation metrics exclude blocked publication time', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const redis = redisFixture(), cache = new MultiTierCache({ redisClient: redis });
    redis.set.mockImplementation(async () => { vi.setSystemTime(1120); return 'OK'; });
    await cache.fetch('board', async () => { vi.setSystemTime(1020); return 7; });
    expect(JSON.parse(redis.set.mock.calls[0][1]).d).toBe(20);
    expect(cache.getMetrics().performance.avgComputeMs).toBe(20);
    expect(cache.getMetrics().performance.computeCount).toBe(1);
  });

  it('independent keys compute while another key is blocked', async () => {
    const cache = new MultiTierCache({ redisClient: redisFixture() }), gate = deferred();
    const slow = cache.fetch('slow', () => gate.promise);
    await tick();
    expect(await cache.fetch('fast', async () => 9)).toBe(9);
    gate.resolve(7); expect(await slow).toBe(7);
  });
});
