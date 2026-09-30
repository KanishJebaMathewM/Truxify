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


