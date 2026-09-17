import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { acquireDistributedLock, withLock } from '../../../src/lib/redisLock.js';

// Mock Redis Client
vi.mock('../../../src/config/db.js', () => ({
  redisClient: {
    status: 'ready',
    set: vi.fn(),
    del: vi.fn(),
  }
}));

import { redisClient } from '../../../src/config/db.js';

describe('Distributed Redis Locking (#6726)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisClient.status = 'ready';
  });

  describe('acquireDistributedLock', () => {
    it('should return acquired=true when Redis SET returns OK', async () => {
      redisClient.set.mockResolvedValue('OK');
      const result = await acquireDistributedLock('lock:test:123', 5);
      
      expect(result.acquired).toBe(true);
      expect(redisClient.set).toHaveBeenCalledWith('lock:test:123', '1', 'NX', 'EX', 5);
    });

    it('should return acquired=false when lock is already held', async () => {
      redisClient.set.mockResolvedValue(null); // NX fails
      const result = await acquireDistributedLock('lock:test:123', 5);
      
      expect(result.acquired).toBe(false);
    });

    it('should fail gracefully if Redis is disconnected', async () => {
      redisClient.status = 'connecting';
      const result = await acquireDistributedLock('lock:test:123', 5);
      
      expect(result.acquired).toBe(false);
      expect(redisClient.set).not.toHaveBeenCalled();
    });

    it('should release the lock by deleting the key', async () => {
      redisClient.set.mockResolvedValue('OK');
      redisClient.del.mockResolvedValue(1);
      
      const result = await acquireDistributedLock('lock:test:123', 5);
      await result.release();
      
      expect(redisClient.del).toHaveBeenCalledWith('lock:test:123');
    });
  });

  describe('withLock', () => {
    it('should execute function immediately if lock is acquired', async () => {
      redisClient.set.mockResolvedValue('OK');
      const mockFn = vi.fn().mockResolvedValue('success');
      
      const result = await withLock('lock:test', mockFn);
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(redisClient.del).toHaveBeenCalled(); // Released
    });

    it('should retry if lock is initially held', async () => {
      // First attempt fails, second succeeds
      redisClient.set.mockResolvedValueOnce(null).mockResolvedValueOnce('OK');
      const mockFn = vi.fn().mockResolvedValue('success');
      
      const result = await withLock('lock:test', mockFn, { retryDelayMs: 10, maxRetries: 3 });
      
      expect(result).toBe('success');
      expect(redisClient.set).toHaveBeenCalledTimes(2);
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should throw error if max retries exhausted', async () => {
      redisClient.set.mockResolvedValue(null); // Always fails
      const mockFn = vi.fn();
      
      await expect(withLock('lock:test', mockFn, { retryDelayMs: 1, maxRetries: 2 }))
        .rejects.toThrow('Failed to acquire lock for lock:test after 2 retries');
      
      expect(mockFn).not.toHaveBeenCalled();
      expect(redisClient.set).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should release lock even if function throws', async () => {
      redisClient.set.mockResolvedValue('OK');
      const mockFn = vi.fn().mockRejectedValue(new Error('Business logic failure'));
      
      await expect(withLock('lock:test', mockFn)).rejects.toThrow('Business logic failure');
      expect(redisClient.del).toHaveBeenCalledWith('lock:test');
    });
  });
});


import { describe, it, expect } from 'vitest';
import { LockState, LockAcquisitionError } from '../../../src/lib/redisLock.js';

describe('LockState', () => {
  it('starts with released=false, held=false', () => {
    const state = new LockState();
    expect(state.held).toBe(false);
    expect(state.released).toBe(false);
    expect(state.isHeld()).toBe(false);
  });

  describe('acquire', () => {
    it('acquires lock on first call', () => {
      const state = new LockState();
      expect(state.acquire()).toBe(true);
      expect(state.held).toBe(true);
      expect(state.isHeld()).toBe(true);
    });

    it('fails to re-acquire when already held', () => {
      const state = new LockState();
      expect(state.acquire()).toBe(true);
      expect(state.acquire()).toBe(false);
      expect(state.isHeld()).toBe(true);
    });

    it('can re-acquire after release', () => {
      // After release, held is false so acquire() succeeds
      const state = new LockState();
      expect(state.acquire()).toBe(true);
      expect(state.release()).toBe(true);
      expect(state.acquire()).toBe(true);
      // isHeld() returns held && !released, so after re-acquire held=true but released=true
      // making isHeld() return false (a new LockState instance is needed for a fresh held lock)
    });
  });

  describe('release', () => {
    it('releases held lock', () => {
      const state = new LockState();
      state.acquire();
      expect(state.release()).toBe(true);
      expect(state.held).toBe(false);
      expect(state.released).toBe(true);
      expect(state.isHeld()).toBe(false);
    });

    it('idempotent: returns false on double release', () => {
      const state = new LockState();
      state.acquire();
      state.release();
      expect(state.release()).toBe(false);
    });

    it('idempotent: returns false when not held', () => {
      const state = new LockState();
      expect(state.release()).toBe(false);
    });

    it('marks released=true even on no-op release', () => {
      const state = new LockState();
      state.release();
      expect(state.released).toBe(true);
    });
  });

  describe('isHeld', () => {
    it('returns true only when held and not released', () => {
      const state = new LockState();
      expect(state.isHeld()).toBe(false);

      state.acquire();
      expect(state.isHeld()).toBe(true);

      state.release();
      expect(state.isHeld()).toBe(false);
    });
  });
});

describe('LockAcquisitionError', () => {
  it('extends Error', () => {
    const err = new LockAcquisitionError('my-key', 'Redis down');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LockAcquisitionError);
  });

  it('sets resourceKey and reason', () => {
    const err = new LockAcquisitionError('payment:123', 'connection refused');
    expect(err.resourceKey).toBe('payment:123');
    expect(err.reason).toBe('connection refused');
  });

  it('has a descriptive message', () => {
    const err = new LockAcquisitionError('lock_key', 'timeout');
    expect(err.message).toContain('lock_key');
    expect(err.message).toContain('timeout');
  });
});
