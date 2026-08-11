import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing redisLock
vi.mock('../../config/db.js', () => ({
  redisClient: null,
}));

describe('redisLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('acquireLock returns null when redisClient is null', async () => {
    const { acquireLock } = await import('../../lib/redisLock.js');
    const result = await acquireLock('test-resource', 5000);
    expect(result).toBeNull();
  });

  it('releaseLock does not throw when redisClient is null', async () => {
    const { releaseLock } = await import('../../lib/redisLock.js');
    await expect(releaseLock('non-existent-lock')).resolves.not.toThrow();
  });
});
