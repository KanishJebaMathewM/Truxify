import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

import {
  ensureIndexes,
  setSupabaseClientForTesting,
  resetClients,
} from '../../src/services/locationService.js';

describe('locationService error logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'production');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetClients();
  });

  it('logs PostGIS index verification failures without throwing', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('postgis unavailable'));
    setSupabaseClientForTesting({ rpc });

    await expect(ensureIndexes()).resolves.toBeUndefined();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Could not verify PostGIS indexes'
    );
  });
});
