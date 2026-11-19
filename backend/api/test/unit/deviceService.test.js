import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: mocks.from },
  supabaseAdmin: { from: mocks.from },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mocks.logger,
}));

import { getUniquePlatforms } from '../../src/services/deviceService.js';

function queryResult(result) {
  const builder = {
    select: vi.fn(() => builder),
    not: vi.fn(() => builder),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

describe('deviceService.getUniquePlatforms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unique, lower-cased, non-empty platforms', async () => {
    mocks.from.mockReturnValueOnce(queryResult({
      data: [
        { platform: 'ANDROID' },
        { platform: 'android' },
        { platform: 'iOS' },
        { platform: null },
        { platform: '' },
      ],
      error: null,
    }));

    const result = await getUniquePlatforms();

    expect(result).toEqual({ success: true, platforms: ['android', 'ios'] });
    expect(mocks.from).toHaveBeenCalledWith('devices');
  });

  it('returns a structured failure when Supabase reports an error', async () => {
    mocks.from.mockReturnValueOnce(queryResult({
      data: null,
      error: { message: 'connection timeout' },
    }));

    const result = await getUniquePlatforms();

    expect(result).toEqual({ success: false, error: 'Database query failed: connection timeout' });
    expect(mocks.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.objectContaining({ message: 'connection timeout' }) }),
      '[deviceService] Failed to retrieve unique platforms',
    );
  });

  it('does not leak an exception when the client throws', async () => {
    mocks.from.mockImplementationOnce(() => {
      throw new Error('client unavailable');
    });

    const result = await getUniquePlatforms();

    expect(result.success).toBe(false);
    expect(result.error).toBe('Database query failed: client unavailable');
  });
});
