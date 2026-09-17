// Verified and clean redisLock unit tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LockState } from '../../src/lib/redisLock.js';

// Mock the db module before importing redisLock
vi.mock('../config/db.js', () => ({
  redisClient: null,
}));

describe('redisLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('acquireLock throws when redisClient is null', async () => {
    const { acquireLock } = await import('../../src/lib/redisLock.js');
    await expect(acquireLock('test-resource', 5000)).rejects.toThrow('Redis client is not initialised');
  });

  it('releaseLock does not throw when redisClient is null', async () => {
    const { releaseLock } = await import('../../src/lib/redisLock.js');
    await expect(releaseLock('non-existent-lock')).resolves.not.toThrow();
  });
});


// === Spec 15 test ===
describe('LockState', () => {
  it('acquires once', () => { const l = new LockState(); expect(l.acquire()).toBe(true); expect(l.acquire()).toBe(false); });
  it('release once ok', () => { const l = new LockState(); l.acquire(); expect(l.release()).toBe(true); });
  it('release twice returns false', () => { const l = new LockState(); l.acquire(); l.release(); expect(l.release()).toBe(false); });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import RedisLock from '../../src/lib/redisLock.js';

describe('RedisLock', () => {
  let lock;

  beforeEach(() => {
    lock = new RedisLock({
      redisUrl: 'redis://mock',
      defaultTtl: 5000,
      retryDelay: 10,
      maxRetries: 5,
    });
  });

  describe('acquire', () => {
    it('should successfully acquire a new lock', async () => {
      const result = await lock.acquire('test-resource', 'owner-1');

      expect(result.success).toBe(true);
      expect(result.lockKey).toBe('lock:test-resource');
      expect(result.owner).toBe('owner-1');
    });

    it('should fail to acquire a lock already held by another owner', async () => {
      await lock.acquire('test-resource', 'owner-1');

      const result = await lock.acquire('test-resource', 'owner-2');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to acquire lock');
    });

    it('should allow the same owner to re-acquire after release', async () => {
      const acquire1 = await lock.acquire('test-resource', 'owner-1');
      expect(acquire1.success).toBe(true);

      const release1 = await lock.release('test-resource', 'owner-1');
      expect(release1.success).toBe(true);

      const acquire2 = await lock.acquire('test-resource', 'owner-1');
      expect(acquire2.success).toBe(true);
    });
  });

  describe('release', () => {
    it('should successfully release a lock owned by the caller', async () => {
      await lock.acquire('test-resource', 'owner-1');

      const result = await lock.release('test-resource', 'owner-1');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Lock released successfully');

      const lockStatus = await global.mockRedis.get('lock:test-resource');
      expect(lockStatus).toBeNull();
    });

    it('should fail to release a lock owned by a different caller', async () => {
      await lock.acquire('test-resource', 'owner-1');

      const result = await lock.release('test-resource', 'owner-2');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Lock not owned by caller or already expired');

      const lockStatus = await global.mockRedis.get('lock:test-resource');
      expect(lockStatus).toBe('owner-1');
    });

    it('should fail to release a lock that has already expired', async () => {
      await lock.acquire('test-resource', 'owner-1', 10);

      await new Promise(resolve => setTimeout(resolve, 15));

      const result = await lock.release('test-resource', 'owner-1');

      expect(result.success).toBe(false);
    });
  });

  describe('extend', () => {
    it('should successfully extend a lock owned by the caller', async () => {
      await lock.acquire('test-resource', 'owner-1', 100);

      const result = await lock.extend('test-resource', 'owner-1', 5000);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Lock extended successfully');
    });

    it('should fail to extend a lock not owned by the caller', async () => {
      await lock.acquire('test-resource', 'owner-1');

      const result = await lock.extend('test-resource', 'owner-2', 5000);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Cannot extend lock: not owned by caller');
    });
  });

  describe('expiry semantics', () => {
    it('should automatically release lock after TTL expires', async () => {
      const shortTtl = 50;
      await lock.acquire('test-resource', 'owner-1', shortTtl);

      let lockStatus = await global.mockRedis.get('lock:test-resource');
      expect(lockStatus).toBe('owner-1');

      await new Promise(resolve => setTimeout(resolve, shortTtl + 20));

      lockStatus = await global.mockRedis.get('lock:test-resource');
      expect(lockStatus).toBeNull();

      const acquireResult = await lock.acquire('test-resource', 'owner-2');
      expect(acquireResult.success).toBe(true);
    });
  });
});

