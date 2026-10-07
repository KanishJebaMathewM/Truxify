import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadLockFallback(redisClient) {
  vi.resetModules();
  vi.doMock('../../../src/config/db.js', () => ({ redisClient }));
  return import('../../../src/lib/lockFallback.js');
}

describe('acquireLockOrFallback', () => {
  it('uses the Redis lock and releases it with the owner token', async () => {
    const redis = {
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1),
    };
    const { acquireLockOrFallback } = await loadLockFallback(redis);

    const lock = await acquireLockOrFallback('escrow_lock:o1', 5000);
    expect(lock.ok).toBe(true);

    const token = redis.set.mock.calls[0][1];
    await lock.release();
    expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining('DEL'), 1, 'escrow_lock:o1', token);
  });

  it('reports ok:false (without running the fallback) when another holder owns the Redis lock', async () => {
    const redis = { set: vi.fn().mockResolvedValue(null), eval: vi.fn() };
    const { acquireLockOrFallback } = await loadLockFallback(redis);

    const lock = await acquireLockOrFallback('escrow_lock:o1', 5000);
    expect(lock.ok).toBe(false);
    await expect(lock.release()).resolves.not.toThrow();
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('falls back to a FIFO in-process mutex when Redis is unavailable', async () => {
    const { acquireLockOrFallback } = await loadLockFallback(null);
    let inside = 0;
    let maxInside = 0;

    // Each caller needs 60ms of a 100ms lease. With the old enqueue-time timer the
    // 2nd..4th leases were already (partly) spent when granted, so callers overlapped.
    const worker = async () => {
      const lock = await acquireLockOrFallback('escrow_lock:o2', 100);
      expect(lock.ok).toBe(true);
      inside++;
      maxInside = Math.max(maxInside, inside);
      await sleep(60);
      inside--;
      await lock.release();
    };
    await Promise.all([worker(), worker(), worker(), worker()]);

    expect(maxInside).toBe(1);
  });

  it('a stale release from an expired fallback lease cannot free the next owner', async () => {
    const { acquireLockOrFallback } = await loadLockFallback(null);

    const stale = await acquireLockOrFallback('escrow_lock:o3', 30);
    const owner = await acquireLockOrFallback('escrow_lock:o3', 1000); // granted once `stale` expires

    let thirdGranted = false;
    const thirdP = acquireLockOrFallback('escrow_lock:o3', 1000).then((lock) => {
      thirdGranted = true;
      return lock;
    });

    await stale.release(); // late release from the expired holder
    await sleep(30);
    expect(thirdGranted).toBe(false); // `owner` still holds the lock

    await owner.release();
    await (await thirdP).release();
    expect(thirdGranted).toBe(true);
  });
});
