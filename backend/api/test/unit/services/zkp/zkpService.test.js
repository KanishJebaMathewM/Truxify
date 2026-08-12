import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('../../../../src/lib/redisLock.js', () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  LockAcquisitionError: class LockAcquisitionError extends Error {},
}));

vi.mock('../../../../src/config/db.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnThis(),
    })),
  },
  supabaseAdmin: null,
}));

const { default: zkpService } = await import('../../../../src/services/zkp/zkp.service.js');

describe('ZKPService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.POLYGON_RPC_URL;
    delete process.env.PRIVATE_KEY;
    delete process.env.KYC_VERIFIER_CONTRACT;
    process.env.ZKP_MOCK = 'true';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    delete process.env.ZKP_MOCK;
    delete process.env.NODE_ENV;
  });

  it('disables itself when required env vars are missing', () => {
    expect(zkpService.contract).toBeNull();
    expect(zkpService.provider).toBeNull();
  });

  it('hashDocument produces a deterministic 64-char hex digest', () => {
    const driverData = {
      name: 'Test User',
      licenseNumber: 'DL-123',
      rcNumber: 'RC-1',
      insuranceNumber: 'POL-1',
      issueDate: '2020-01-01',
      expiryDate: '2030-01-01',
    };
    const h1 = zkpService.hashDocument(driverData);
    const h2 = zkpService.hashDocument(driverData);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('callSnarkJS returns a mock proof in test mode', async () => {
    const proofData = await zkpService.callSnarkJS({ name: 'A' }, '0xhash');
    expect(proofData.isMock).toBe(true);
    expect(proofData.proof.a).toBeDefined();
    expect(proofData.publicSignals).toContain('0xhash');
  });

  it('callSnarkJS throws when mock proofs are attempted in production', async () => {
    process.env.ZKP_MOCK = 'true';
    process.env.NODE_ENV = 'production';
    await expect(zkpService.callSnarkJS({ name: 'A' }, '0xhash')).rejects.toThrow(/disallowed in production/);
    delete process.env.NODE_ENV;
  });

  it('callSnarkJS still mocks in test mode even when ZKP_MOCK is false', async () => {
    process.env.ZKP_MOCK = 'false';
    const proofData = await zkpService.callSnarkJS({ name: 'A' }, '0xhash');
    expect(proofData.isMock).toBe(true);
  });
});
