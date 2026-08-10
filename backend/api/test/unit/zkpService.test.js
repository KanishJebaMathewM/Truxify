import { describe, it, expect, vi, beforeEach } from 'vitest';

const { lockMock } = vi.hoisted(() => ({
  lockMock: { acquireLock: vi.fn(), releaseLock: vi.fn(), LockAcquisitionError: class extends Error {} },
}));

vi.mock('../../src/lib/redisLock.js', () => lockMock);

const { dbMock } = vi.hoisted(() => ({
  dbMock: { supabase: { from: vi.fn() } },
}));

vi.mock('../../src/config/db.js', () => ({
  get supabase() { return dbMock.supabase; },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import ZKPService from '../../src/services/zkp/zkp.service.js';

describe('zkp.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ZKP_LOCK_TTL_MS;
    lockMock.releaseLock.mockResolvedValue(true);
  });

  describe('hashDocument', () => {
    it('produces a deterministic 64-char hex hash', () => {
      const data = { name: 'A', licenseNumber: 'L1', rcNumber: 'R1', insuranceNumber: 'I1', issueDate: '2020-01-01', expiryDate: '2030-01-01' };
      const h1 = ZKPService.hashDocument(data);
      const h2 = ZKPService.hashDocument(data);
      expect(h1).toMatch(/^[a-f0-9]{64}$/);
      expect(h1).toBe(h2);
    });

    it('changes when input changes', () => {
      const base = { name: 'A', licenseNumber: 'L1', rcNumber: 'R1', insuranceNumber: 'I1', issueDate: '2020-01-01', expiryDate: '2030-01-01' };
      const h1 = ZKPService.hashDocument(base);
      const h2 = ZKPService.hashDocument({ ...base, name: 'B' });
      expect(h1).not.toBe(h2);
    });
  });

  describe('verifyDriver', () => {
    it('returns a conflict result when the lock is held', async () => {
      lockMock.acquireLock.mockResolvedValue(null);
      const result = await ZKPService.verifyDriver({ userId: 'u1' });
      expect(result.success).toBe(false);
      expect(result.conflict).toBe(true);
    });

    it('returns alreadyVerified when the user is already KYC-verified', async () => {
      lockMock.acquireLock.mockResolvedValue('token-1');
      lockMock.releaseLock.mockResolvedValue(true);
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { kyc_verified: true }, error: null }) })) })),
      });
      const result = await ZKPService.verifyDriver({ userId: 'u1' });
      expect(result.success).toBe(true);
      expect(result.alreadyVerified).toBe(true);
      expect(result.verified).toBe(true);
    });

    it('releases the lock in the finally block', async () => {
      lockMock.acquireLock.mockResolvedValue('token-2');
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { kyc_verified: false }, error: null }) })) })),
      });
      // generateZKProof will try supabase store; make it fail to hit finally
      dbMock.supabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { kyc_verified: false }, error: null }) })) })),
      });
      const result = await ZKPService.verifyDriver({ userId: 'u1' });
      expect(lockMock.releaseLock).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });
  });
});
