import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing redisLock. redisClient is a live
// getter so tests can swap the backing redis instance via redisHolder.client.
const redisHolder = vi.hoisted(() => ({ client: null }));

vi.mock('../../src/config/db.js', () => ({
  get redisClient() {
    return redisHolder.client;
  },
}));

import { acquireLock, renewLock, releaseLock, LockAcquisitionError } from '../../src/lib/redisLock.js';

function makeRedis({ setResult = 'OK', evalResult = 1, throwOn } = {}) {
  const redis = {
    set: vi.fn(async () => {
      if (throwOn === 'set') throw new Error('Redis connection lost');
      return setResult;
    }),
    eval: vi.fn(async () => {
      if (throwOn === 'eval') throw new Error('Redis eval failed');
      return evalResult;
    }),
  };
  return redis;
}

describe('redisLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('acquireLock throws (fails closed) when redisClient is null', async () => {
    await expect(acquireLock('test-resource', 5000)).rejects.toBeInstanceOf(LockAcquisitionError);
  });

  it('releaseLock does not throw when redisClient is null', async () => {
    await expect(releaseLock('non-existent-lock')).resolves.not.toThrow();
  });
});

// ─── releaseLock ─────────────────────────────────────────────────────────────

describe('releaseLock', () => {
  afterEach(() => {
    redisHolder.client = null;
  });

  it('returns true when Lua script confirms we hold the lock', async () => {
    redisHolder.client = makeRedis({ evalResult: 1 });

    const result = await releaseLock('test:key', 'some-uuid');
    expect(result).toBe(true);
  });

  it('returns false when Lua script says we no longer hold the lock (expired / stolen)', async () => {
    redisHolder.client = makeRedis({ evalResult: 0 });

    const result = await releaseLock('test:key', 'stale-uuid');
    expect(result).toBe(false);
  });

  it('returns false (does not throw) when Redis eval throws', async () => {
    redisHolder.client = makeRedis({ throwOn: 'eval' });

    await expect(releaseLock('test:key', 'some-uuid')).resolves.toBe(false);
  });

  it('returns false when lockValue is null (no-op guard)', async () => {
    redisHolder.client = makeRedis();

    const result = await releaseLock('test:key', null);
    expect(result).toBe(false);
  });

  it('returns false when lockValue is undefined (no-op guard)', async () => {
    redisHolder.client = makeRedis();

    const result = await releaseLock('test:key', undefined);
    expect(result).toBe(false);
  });

  it('passes the lockValue as ARGV[1] to the Lua script', async () => {
    const redis = makeRedis({ evalResult: 1 });
    redisHolder.client = redis;

    const token = 'abc-123-uuid';
    await releaseLock('test:key', token);

    // eval(script, numkeys, key, argv1, ...)
    const evalArgs = redis.eval.mock.calls[0];
    expect(evalArgs[2]).toBe('test:key'); // KEYS[1]
    expect(evalArgs[3]).toBe(token);      // ARGV[1]
  });
});

// ─── renewLock ───────────────────────────────────────────────────────────────

describe('renewLock', () => {
  afterEach(() => {
    redisHolder.client = null;
  });

  it('returns true when Lua confirms we still hold the lock', async () => {
    redisHolder.client = makeRedis({ evalResult: 1 });
    expect(await renewLock('test:key', 'uuid', 5000)).toBe(true);
  });

  it('returns false when we no longer hold the lock', async () => {
    redisHolder.client = makeRedis({ evalResult: 0 });
    expect(await renewLock('test:key', 'stale', 5000)).toBe(false);
  });

  it('returns false when redisClient is null', async () => {
    redisHolder.client = null;
    expect(await renewLock('test:key', 'uuid', 5000)).toBe(false);
  });

  it('returns false when lockValue is falsy', async () => {
    redisHolder.client = makeRedis();
    expect(await renewLock('test:key', '', 5000)).toBe(false);
    expect(await renewLock('test:key', null, 5000)).toBe(false);
  });

  it('returns false (does not throw) when Redis eval throws during renewal', async () => {
    redisHolder.client = makeRedis({ throwOn: 'eval' });

    await expect(renewLock('test:key', 'uuid', 5000)).resolves.toBe(false);
  });
});

// ─── Integration-style: guarded mutation must be rejected when Redis is down ──

describe('Critical section protection — Redis down must block the operation', () => {
  afterEach(() => {
    redisHolder.client = null;
  });

  /**
   * Simulates what a route handler does:
   *   1. acquireLock
   *   2. perform mutation
   *   3. releaseLock
   * Returns the HTTP-like status that would be sent to the client.
   */
  async function simulateProtectedMutation(lockKey) {
    let lockValue = null;
    let mutationPerformed = false;
    let responseStatus;

    try {
      lockValue = await acquireLock(lockKey, 30_000);
      if (lockValue === null) {
        responseStatus = 409; // Already locked by another process
        return { status: responseStatus, mutationPerformed };
      }

      // Critical section — must NOT execute when Redis is down.
      mutationPerformed = true;
      responseStatus = 201;

    } catch (err) {
      if (err instanceof LockAcquisitionError) {
        responseStatus = 503; // Service unavailable
      } else {
        responseStatus = 500;
      }
    } finally {
      if (lockValue) {
        await releaseLock(lockKey, lockValue).catch(() => {});
      }
    }

    return { status: responseStatus, mutationPerformed };
  }

  it('mutation is NOT performed and 503 is returned when Redis is down', async () => {
    redisHolder.client = null; // Redis not available

    const { status, mutationPerformed } =
      await simulateProtectedMutation('payment_lock:order_99');

    expect(mutationPerformed).toBe(false);
    expect(status).toBe(503);
  });

  it('mutation is NOT performed and 503 is returned when Redis SET throws', async () => {
    redisHolder.client = makeRedis({ throwOn: 'set' });

    const { status, mutationPerformed } =
      await simulateProtectedMutation('payment_lock:order_99');

    expect(mutationPerformed).toBe(false);
    expect(status).toBe(503);
  });

  it('mutation IS performed (201) when Redis lock is available', async () => {
    redisHolder.client = makeRedis({ setResult: 'OK', evalResult: 1 });

    const { status, mutationPerformed } =
      await simulateProtectedMutation('payment_lock:order_99');

    expect(mutationPerformed).toBe(true);
    expect(status).toBe(201);
  });

  it('mutation is NOT performed (409) when lock is already held', async () => {
    redisHolder.client = makeRedis({ setResult: null }); // NX returns null = already locked

    const { status, mutationPerformed } =
      await simulateProtectedMutation('payment_lock:order_99');

    expect(mutationPerformed).toBe(false);
    expect(status).toBe(409);
  });
});

// ─── Owner-aware lifecycle with a deterministic in-memory Redis ─────────────
//
// These tests exercise the full acquire → renew → expire → re-acquire →
// release sequence against a fake Redis whose clock can be advanced manually,
// so lock-stealing and TTL-expiry scenarios are deterministic. They prove the
// "previous owner must never delete the new owner's lock" guarantee end to end.

/**
 * Minimal in-memory Redis fake implementing exactly the commands redisLock
 * uses — `SET … PX … NX` plus the two owner-checked Lua scripts (renew and
 * release) — with a manually-controllable clock for deterministic expiry.
 */
function makeInMemoryRedis() {
  const entries = new Map(); // key -> { value, expiresAtMs | null }
  let clock = 0;

  // Returns the live entry for a key, lazily dropping it once its TTL lapses.
  function alive(key) {
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs !== null && clock >= entry.expiresAtMs) {
      entries.delete(key);
      return null;
    }
    return entry;
  }

  return {
    set: vi.fn(async (key, value, mode, num, nx) => {
      // set(key, value, 'PX', ttlMs, 'NX') — NX must reject if the key is held.
      if (nx === 'NX' && alive(key)) return null;
      const ttlMs = mode === 'PX' ? Number(num) : null;
      entries.set(key, { value, expiresAtMs: ttlMs === null ? null : clock + ttlMs });
      return 'OK';
    }),
    eval: vi.fn(async (script, numKeys, key, token, ttlArg) => {
      // Owner-checked Lua: only acts when the stored value matches the token.
      const entry = alive(key);
      if (!entry || entry.value !== token) return 0;
      if (script.includes('PEXPIRE')) {
        entry.expiresAtMs = clock + Number(ttlArg);
      } else if (script.includes('DEL')) {
        entries.delete(key);
      }
      return 1;
    }),
    advance(ms) {
      clock += ms;
    },
  };
}

describe('redisLock owner-aware lifecycle', () => {
  afterEach(() => {
    redisHolder.client = null;
  });

  it('only the owner can renew the lock (non-owner renewal is rejected)', async () => {
    const redis = makeInMemoryRedis();
    redisHolder.client = redis;

    const token = await acquireLock('test:key', 10_000);
    expect(token).toBeTruthy();

    expect(await renewLock('test:key', token, 10_000)).toBe(true);
    expect(await renewLock('test:key', 'another-replica-token', 10_000)).toBe(false);

    // Even the original owner cannot renew once the lock has expired.
    redis.advance(10_001);
    expect(await renewLock('test:key', token, 10_000)).toBe(false);
  });

  it('only the owner can release the lock (non-owner release is rejected)', async () => {
    const redis = makeInMemoryRedis();
    redisHolder.client = redis;

    const token = await acquireLock('test:key', 10_000);

    expect(await releaseLock('test:key', 'another-replica-token')).toBe(false);
    expect(await releaseLock('test:key', token)).toBe(true);
    expect(await releaseLock('test:key', token)).toBe(false); // already released
  });

  it('an expired lock can be acquired by another replica', async () => {
    const redis = makeInMemoryRedis();
    redisHolder.client = redis;

    const first = await acquireLock('test:key', 10_000);
    expect(first).toBeTruthy();
    expect(await acquireLock('test:key', 10_000)).toBeNull(); // held while alive

    redis.advance(10_001); // first owner's TTL lapses

    const second = await acquireLock('test:key', 10_000);
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it('an old owner can never delete the new owner lock', async () => {
    const redis = makeInMemoryRedis();
    redisHolder.client = redis;

    const oldToken = await acquireLock('test:key', 10_000);
    redis.advance(10_001); // old owner stalls past its TTL

    const newToken = await acquireLock('test:key', 10_000);
    expect(newToken).toBeTruthy();

    // Old owner reaches its finally block with a stale token: the release must
    // be rejected atomically and must not touch the new owner's lock.
    expect(await releaseLock('test:key', oldToken)).toBe(false);

    // The new owner's lock is intact: it can renew and release normally.
    expect(await renewLock('test:key', newToken, 10_000)).toBe(true);
    expect(await releaseLock('test:key', newToken)).toBe(true);
  });

  it('renewal keeps the lock alive across its TTL (no premature expiry)', async () => {
    const redis = makeInMemoryRedis();
    redisHolder.client = redis;

    const token = await acquireLock('test:key', 10_000);
    redis.advance(9_000);
    expect(await renewLock('test:key', token, 10_000)).toBe(true);
    redis.advance(9_000);
    // Renewed, so it is still alive well past the original TTL.
    expect(await acquireLock('test:key', 10_000)).toBeNull();
  });
});
