import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: vi.fn() },
}));

vi.mock('../../src/oracle/OracleService.js', () => ({
  default: class MockOracleService {
    async confirmDelivery() {
      return {
        confirmed: true,
        consensusCount: 2,
        threshold: 2,
        totalProviders: 3,
        providerResults: [{ provider: 'a', confirmed: true }, { provider: 'b', confirmed: true }],
        timestamp: new Date().toISOString(),
      };
    }
    async verifyCrossChain() {
      return { verified: false, ipfsHash: null };
    }
  },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('VerificationService', () => {
  let VerificationService;
  let svc;
  let mockSupabaseFrom;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const db = await import('../../src/config/db.js');
    const { supabase } = db;
    mockSupabaseFrom = supabase.from;
    const mod = await import('../../src/services/verification/VerificationService.js');
    VerificationService = mod.default;
    svc = new VerificationService();
  });

  describe('verifyOrder', () => {
    it('returns verified:false with error when order is not found', async () => {
      const selectFn = vi.fn();
      const eqFn = vi.fn();
      const maybeSingleFn = vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } });
      eqFn.mockReturnValue({ maybeSingle: maybeSingleFn });
      selectFn.mockReturnValue({ eq: eqFn });
      mockSupabaseFrom.mockReturnValue({ select: selectFn });

      const result = await svc.verifyOrder('nonexistent-order');
      expect(result.verified).toBe(false);
      expect(result.error).toBe('Not found');
    });
  });

  describe('checkDocumentIntegrity', () => {
    it('returns verified:false with missing documents when driverId is null', async () => {
      const result = await svc.checkDocumentIntegrity(null);
      expect(result.verified).toBe(false);
      expect(result.documentsChecked).toHaveLength(2);
      expect(result.documentsChecked.every(d => d.uploaded === false)).toBe(true);
    });

    it('returns verified:true when all required documents are approved', async () => {
      const selectFn = vi.fn();
      const eqFn = vi.fn().mockResolvedValue({
        data: [
          { document_type: 'rc_book', status: 'approved', created_at: new Date().toISOString() },
          { document_type: 'driving_licence', status: 'approved', created_at: new Date().toISOString() },
        ],
        error: null,
      });
      selectFn.mockReturnValue({ eq: eqFn });
      mockSupabaseFrom.mockReturnValue({ select: selectFn });

      const result = await svc.checkDocumentIntegrity('driver-1');
      expect(result.verified).toBe(true);
      expect(result.documentsChecked).toHaveLength(2);
    });
  });
});
