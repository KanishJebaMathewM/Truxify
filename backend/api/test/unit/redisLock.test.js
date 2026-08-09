/**
 * @file redisLock.test.js
 *
 * Unit tests for backend/api/src/lib/redisLock.js
 *
 * Run with: npx vitest run test/unit/redisLock.test.js
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// ─── Mock the Redis client ────────────────────────────────────────────────────

// We mock the db module so we can swap redisClient between tests. The holder
// is hoisted because vi.mock factories are lifted above module-level bindings.
const redisHolder = vi.hoisted(() => ({ client: null }));

vi.mock('../../src/config/db.js', () => ({
  get redisClient() {
    return redisHolder.client;
  },
}));

// Suppress logger noise in test output.
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Import after mocks are registered.
const { acquireLock, releaseLock, renewLock, LockAcquisitionError } =
  await import('../../src/lib/redisLock.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRedis({ setResult = 'OK', evalResult = 1, throwOn = null } = {}) {
  return {
    set: vi.fn(async (...args) => {
      if (throwOn === 'set') throw new Error('Redis connection refused');
      return setResult;
    }),
    eval: vi.fn(async (...args) => {
      if (throwOn === 'eval') throw new Error('Redis connection refused');
      return evalResult;
    }),
    del: vi.fn(async () => 1),
  };
}

// ─── acquireLock ─────────────────────────────────────────────────────────────

describe('acquireLock', () => {
  afterEach(() => {
    redisHolder.client = null;
  });

  // ── Fail-closed tests (the core bug fix) ──────────────────────────────────

  it('throws LockAcquisitionError when redisClient is null (not initialised)', async () => {
    redisHolder.client = null; // Redis not configured

    await expect(acquireLock('test:key', 5000))
      .rejects
      .toThrow(LockAcquisitionError);
  });

  it('throws LockAcquisitionError (not silently returns null) when Redis SET throws', async () => {
    redisHolder.client = makeRedis({ throwOn: 'set' });

    await expect(acquireLock('test:key', 5000))
      .rejects
      .toThrow(LockAcquisitionError);
  });

  it('LockAcquisitionError carries the resourceKey', async () => {
    redisHolder.client = null;
    let caughtErr;
    try {
      await acquireLock('payment_lock:order_42', 5000);
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr).toBeInstanceOf(LockAcquisitionError);
    expect(caughtErr.resourceKey).toBe('payment_lock:order_42');
  });

  // ── Normal success / contention paths ────────────────────────────────────

  it('returns a UUID string when SET NX succeeds', async () => {
    redisHolder.client = makeRedis({ setResult: 'OK' });

    const result = await acquireLock('test:key', 5000);
    expect(typeof result).toBe('string');
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('returns null (not throws) when lock is already held by another process', async () => {
    // SET NX returns null when the key already exists.
    redisHolder.client = makeRedis({ setResult: null });

    const result = await acquireLock('test:key', 5000);
    expect(result).toBeNull();
  });

  it('passes the correct TTL (in ms) to Redis SET', async () => {
    const redis = makeRedis({ setResult: 'OK' });
    redisHolder.client = redis;

    await acquireLock('test:key', 30_000);

    const [, , , ttl] = redis.set.mock.calls[0];
    expect(ttl).toBe(30_000);
  });

  it('passes NX flag to Redis SET', async () => {
    const redis = makeRedis({ setResult: 'OK' });
    redisHolder.client = redis;

    await acquireLock('test:key', 5000);

    const setArgs = redis.set.mock.calls[0];
    expect(setArgs).toContain('NX');
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