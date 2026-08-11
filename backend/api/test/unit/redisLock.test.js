import { describe, it, expect, vi, beforeEach } from 'vitest';

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
