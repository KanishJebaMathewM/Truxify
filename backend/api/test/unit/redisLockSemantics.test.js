import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

async function loadRedisLock(redisClient) {
  vi.resetModules();
  vi.doMock('../../src/config/db.js', () => ({ redisClient }));
  const mod = await import('../../src/lib/redisLock.js');
  return mod;
}

describe('redisLock acquire/renew/release semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('acquireLock throws LockAcquisitionError when Redis is unavailable', async () => {
    const { acquireLock, LockAcquisitionError } = await loadRedisLock(null);
    await expect(acquireLock('res', 1000)).rejects.toBeInstanceOf(LockAcquisitionError);
  });

  it('acquireLock returns the owner token on success', async () => {
    const redis = { set: vi.fn().mockResolvedValue('OK') };
    const { acquireLock } = await loadRedisLock(redis);

    const token = await acquireLock('res', 1000);

    expect(token).toBeTypeOf('string');
    expect(redis.set).toHaveBeenCalledWith('res', expect.any(String), 'PX', 1000, 'NX');
  });

  it('acquireLock returns null when the lock is held', async () => {
    const redis = { set: vi.fn().mockResolvedValue(null) };
    const { acquireLock } = await loadRedisLock(redis);

    expect(await acquireLock('res', 1000)).toBeNull();
  });

  it('acquireLock throws LockAcquisitionError on Redis error', async () => {
    const redis = { set: vi.fn().mockRejectedValue(new Error('redis down')) };
    const { acquireLock, LockAcquisitionError } = await loadRedisLock(redis);

    await expect(acquireLock('res', 1000)).rejects.toBeInstanceOf(LockAcquisitionError);
  });

  it('releaseLock runs the Lua script and reports ownership', async () => {
    const redis = { eval: vi.fn().mockResolvedValue(1) };
    const { releaseLock } = await loadRedisLock(redis);

    expect(await releaseLock('res', 'token-1')).toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining('DEL'), 1, 'res', 'token-1');
  });

  it('releaseLock returns false when the lock is not ours', async () => {
    const redis = { eval: vi.fn().mockResolvedValue(0) };
    const { releaseLock } = await loadRedisLock(redis);

    expect(await releaseLock('res', 'wrong-token')).toBe(false);
  });

  it('releaseLock is a safe no-op without a client or token', async () => {
    const { releaseLock } = await loadRedisLock(null);
    expect(await releaseLock('res', null)).toBe(false);
    expect(await releaseLock('res', '')).toBe(false);
  });

  it('renewLock extends the TTL when we still hold it', async () => {
    const redis = { eval: vi.fn().mockResolvedValue(1) };
    const { renewLock } = await loadRedisLock(redis);

    expect(await renewLock('res', 'token-1', 30000)).toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('PEXPIRE'),
      1,
      'res',
      'token-1',
      '30000',
    );
  });

  it('renewLock returns false when the lock is not ours', async () => {
    const redis = { eval: vi.fn().mockResolvedValue(0) };
    const { renewLock } = await loadRedisLock(redis);

    expect(await renewLock('res', 'other', 30000)).toBe(false);
  });

  it('releaseLock returns false on a Lua script error', async () => {
    const redis = { eval: vi.fn().mockRejectedValue(new Error('redis down')) };
    const { releaseLock } = await loadRedisLock(redis);

    expect(await releaseLock('res', 'token-1')).toBe(false);
  });

  it('acquireLock passes a custom TTL to SET NX PX', async () => {
    const redis = { set: vi.fn().mockResolvedValue('OK') };
    const { acquireLock } = await loadRedisLock(redis);

    await acquireLock('res', 45000);
    expect(redis.set).toHaveBeenCalledWith('res', expect.any(String), 'PX', 45000, 'NX');
  });

  it('releaseLock treats a falsy token as a no-op without calling eval', async () => {
    const redis = { eval: vi.fn() };
    const { releaseLock } = await loadRedisLock(redis);

    expect(await releaseLock('res', undefined)).toBe(false);
    expect(redis.eval).not.toHaveBeenCalled();
  });
});
