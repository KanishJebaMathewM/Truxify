import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { acquireDistributedLock, withLock } from '../../../src/lib/redisLock.js';

// Mock Redis Client
vi.mock('../../../src/config/db.js', () => ({
  redisClient: {
    status: 'ready',
    set: vi.fn(),
    del: vi.fn(),
    eval: vi.fn(),
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
      // The stored value is a unique owner token (never the shared constant '1'),
      // otherwise one holder could release another holder's lock.
      expect(redisClient.set).toHaveBeenCalledWith('lock:test:123', expect.any(String), 'NX', 'EX', 5);
      const token = redisClient.set.mock.calls[0][1];
      expect(token).not.toBe('1');
      expect(token.length).toBeGreaterThan(8);
    });

    it('should use a distinct owner token for every acquisition', async () => {
      redisClient.set.mockResolvedValue('OK');
      await acquireDistributedLock('lock:test:123', 5);
      await acquireDistributedLock('lock:test:123', 5);

      const [first, second] = redisClient.set.mock.calls.map((call) => call[1]);
      expect(first).not.toBe(second);
    });

    it('should return acquired=false when lock is already held', async () => {
      redisClient.set.mockResolvedValue(null); // NX fails
      const result = await acquireDistributedLock('lock:test:123', 5);
      
      expect(result.acquired).toBe(false);
    });

    it('should fall back to the local mutex when Redis is disconnected', async () => {
      redisClient.status = 'connecting';
      const result = await acquireDistributedLock('lock:test:123', 5);

      expect(result.acquired).toBe(true);
      expect(redisClient.set).not.toHaveBeenCalled();
      await result.release();
    });

    it('should release with an atomic owner-checked delete (never a bare DEL)', async () => {
      redisClient.set.mockResolvedValue('OK');
      redisClient.eval.mockResolvedValue(1);

      const result = await acquireDistributedLock('lock:test:123', 5);
      const token = redisClient.set.mock.calls[0][1];
      await expect(result.release()).resolves.toBe(true);

      expect(redisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('DEL'), 1, 'lock:test:123', token
      );
      expect(redisClient.del).not.toHaveBeenCalled();
    });

    it('should not free a lock that now belongs to someone else', async () => {
      redisClient.set.mockResolvedValue('OK');
      redisClient.eval.mockResolvedValue(0); // key expired and was re-acquired by another holder

      const result = await acquireDistributedLock('lock:test:123', 5);
      await expect(result.release()).resolves.toBe(false);
      expect(redisClient.del).not.toHaveBeenCalled();
    });

    it('should only issue the release once even if release() is called twice', async () => {
      redisClient.set.mockResolvedValue('OK');
      redisClient.eval.mockResolvedValue(1);

      const result = await acquireDistributedLock('lock:test:123', 5);
      await result.release();
      await expect(result.release()).resolves.toBe(false);

      expect(redisClient.eval).toHaveBeenCalledTimes(1);
    });
  });

  describe('withLock', () => {
    it('should execute function immediately if lock is acquired', async () => {
      redisClient.set.mockResolvedValue('OK');
      const mockFn = vi.fn().mockResolvedValue('success');
      
      const result = await withLock('lock:test', mockFn);
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(redisClient.eval).toHaveBeenCalled(); // Released (owner-checked)
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
      expect(redisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('DEL'), 1, 'lock:test', expect.any(String)
      );
    });
  });
});


