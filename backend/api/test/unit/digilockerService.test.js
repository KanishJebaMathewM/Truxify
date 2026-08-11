import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('axios');

vi.mock('../../src/config/db.js', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

describe('DigilockerService', () => {
  let DigilockerService;
  let service;
  let mockSupabase;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    mockSupabase = {
      from: vi.fn(),
    };

    vi.doMock('../../src/config/db.js', () => ({
      supabase: mockSupabase,
    }));

    const mod = await import('../../src/services/digilockerService.js');
    // Re-instantiate to get a fresh service with our mocks
    // Since it's a singleton, we access the class directly
    DigilockerService = mod.default.constructor;
    service = new DigilockerService();
    // Force mock mode by setting the env var before the test runs
    process.env.DIGILOCKER_MOCK = 'true';
    service = new DigilockerService();
  });

  afterEach(() => {
    delete process.env.DIGILOCKER_MOCK;
    delete process.env.DIGILOCKER_CLIENT_ID;
    delete process.env.DIGILOCKER_CLIENT_SECRET;
    vi.resetModules();
  });

  describe('isMock', () => {
    it('returns true when DIGILOCKER_MOCK is set', () => {
      process.env.DIGILOCKER_MOCK = 'true';
      const s = new DigilockerService();
      expect(s.isMock).toBe(true);
    });

    it('returns false when DIGILOCKER_MOCK is not set', () => {
      delete process.env.DIGILOCKER_MOCK;
      const s = new DigilockerService();
      expect(s.isMock).toBe(false);
    });

    it('returns false in production even when DIGILOCKER_MOCK is true', () => {
      process.env.NODE_ENV = 'production';
      process.env.DIGILOCKER_MOCK = 'true';
      const s = new DigilockerService();
      expect(s.isMock).toBe(false);
      process.env.NODE_ENV = 'test';
    });
  });

  describe('exchangeCode', () => {
    it('returns mock token in mock mode', async () => {
      process.env.DIGILOCKER_MOCK = 'true';
      const s = new DigilockerService();
      const result = await s.exchangeCode('test-code');
      expect(result).toHaveProperty('access_token');
      expect(result.access_token).toMatch(/^mock_digilocker_token_/);
      expect(result).toHaveProperty('digilocker_id');
      expect(result).toHaveProperty('name');
    });

    it('returns error when credentials missing and not in mock mode', async () => {
      delete process.env.DIGILOCKER_MOCK;
      delete process.env.DIGILOCKER_CLIENT_ID;
      const s = new DigilockerService();
      const result = await s.exchangeCode('test-code');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured');
    });
  });

  describe('verifyDocuments', () => {
    it('verifies documents in mock mode and returns success', async () => {
      process.env.DIGILOCKER_MOCK = 'true';
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      });

      const s = new DigilockerService();
      const result = await s.verifyDocuments('user-123', 'mock-token');
      expect(result.success).toBe(true);
      expect(result.is_digilocker_verified).toBe(true);
      expect(result).toHaveProperty('document_hash');
      expect(result.verified_documents).toContain('driving_licence');
      expect(result.verified_documents).toContain('rc_book');
    });

    it('returns error when not configured and not in mock mode', async () => {
      delete process.env.DIGILOCKER_MOCK;
      delete process.env.DIGILOCKER_CLIENT_ID;
      const s = new DigilockerService();
      const result = await s.verifyDocuments('user-123', 'token');
      expect(result.success).toBe(false);
      expect(result.is_digilocker_verified).toBe(false);
    });
  });
});
