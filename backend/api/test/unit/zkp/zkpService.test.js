import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../src/config/db.js', () => ({
  supabase: { from: vi.fn() },
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(),
      })),
    })),
  },
}));

vi.mock('../../../src/lib/redisLock.js', () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  LockAcquisitionError: class LockAcquisitionError extends Error {
    constructor() { super('Lock not acquired'); }
  },
}));

vi.mock('ethers', () => ({
  ethers: { JsonRpcProvider: vi.fn(), Wallet: vi.fn() },
  default: { JsonRpcProvider: vi.fn(), Wallet: vi.fn() },
}));

const ZKPService = (await import('../../../src/services/zkp/zkp.service.js')).default;

describe('zkp.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('disabled state', () => {
    it('service starts disabled when env vars are missing', () => {
      expect(ZKPService.provider).toBeNull();
      expect(ZKPService.wallet).toBeNull();
    });
  });
});
