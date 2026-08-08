import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: mockFrom },
}));

describe('VerificationService', () => {
  let VerificationService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    VerificationService = (await import('../../src/services/verification/VerificationService.js')).default;
  });

  describe('verifyDocument', () => {
    it('marks document as verified when all checks pass', async () => {
      const mockDoc = { id: 'doc-1', user_id: 'user-1', status: 'pending' };
      mockFrom
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockDoc, error: null }),
        })
        .mockReturnValueOnce({
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        });

      const result = await VerificationService.verifyDocument('doc-1');
      expect(result).toBeTruthy();
    });

    it('returns false when document not found', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
      });

      const result = await VerificationService.verifyDocument('doc-nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('rejectDocument', () => {
    it('updates document status to rejected', async () => {
      const mockDoc = { id: 'doc-1', status: 'pending' };
      mockFrom
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockDoc, error: null }),
        })
        .mockReturnValueOnce({
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        });

      const result = await VerificationService.rejectDocument('doc-1', 'Document is blurry');
      expect(result).toBeTruthy();
    });
  });
});
