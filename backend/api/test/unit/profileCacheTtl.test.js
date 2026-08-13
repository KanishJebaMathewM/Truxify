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

describe('setCachedProfile TTL clamping', () => {
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

  it('clamps a TTL below 1 second up to 1', async () => {
    const { setCachedProfile } = await load();
    await setCachedProfile('fb-1', { id: 'p1' }, 0);
    expect(redisMock.set).toHaveBeenCalledWith(
      expect.stringContaining('fb-1'),
      expect.any(String),
      'EX',
      1,
    );
  });

  it('clamps a TTL above 86400 down to 86400', async () => {
    const { setCachedProfile } = await load();
    await setCachedProfile('fb-1', { id: 'p1' }, 999999);
    expect(redisMock.set).toHaveBeenCalledWith(
      expect.stringContaining('fb-1'),
      expect.any(String),
      'EX',
      86400,
    );
  });

  it('clamps a non-finite TTL to 1', async () => {
    const { setCachedProfile } = await load();
    await setCachedProfile('fb-1', { id: 'p1' }, NaN);
    expect(redisMock.set).toHaveBeenCalledWith(
      expect.stringContaining('fb-1'),
      expect.any(String),
      'EX',
      1,
    );
  });

  it('keeps a valid TTL unchanged', async () => {
    const { setCachedProfile } = await load();
    await setCachedProfile('fb-1', { id: 'p1' }, 120);
    expect(redisMock.set).toHaveBeenCalledWith(
      expect.stringContaining('fb-1'),
      expect.any(String),
      'EX',
      120,
    );
  });
});
