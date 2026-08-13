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

describe('getCachedProfile payload validation', () => {
  let redisMock;

  beforeEach(() => {
    vi.clearAllMocks();
    redisMock = { get: vi.fn(), set: vi.fn(), del: vi.fn() };
    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({ redisClient: redisMock }));
  });

  async function load() {
    return import('../../src/lib/profileCache.js');
  }

  it('returns the parsed profile for a valid JSON object payload', async () => {
    const { getCachedProfile } = await load();
    redisMock.get.mockResolvedValue(JSON.stringify({ id: 'p1', role: 'driver' }));
    const result = await getCachedProfile('fb-1');
    expect(result).toEqual({ id: 'p1', role: 'driver' });
    expect(redisMock.del).not.toHaveBeenCalled();
  });

  it('treats a numeric JSON payload as a miss and deletes the corrupt key', async () => {
    const { getCachedProfile } = await load();
    redisMock.get.mockResolvedValue('42');
    const result = await getCachedProfile('fb-1');
    expect(result).toBeNull();
    expect(redisMock.del).toHaveBeenCalledWith(expect.stringContaining('fb-1'));
  });

  it('treats a string JSON payload as a miss and deletes the corrupt key', async () => {
    const { getCachedProfile } = await load();
    redisMock.get.mockResolvedValue(JSON.stringify('not-an-object'));
    const result = await getCachedProfile('fb-1');
    expect(result).toBeNull();
    expect(redisMock.del).toHaveBeenCalled();
  });

  it('treats a JSON array payload as a miss', async () => {
    const { getCachedProfile } = await load();
    redisMock.get.mockResolvedValue(JSON.stringify([{ id: 'p1' }]));
    const result = await getCachedProfile('fb-1');
    expect(result).toBeNull();
  });
});
