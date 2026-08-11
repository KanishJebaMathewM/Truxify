import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const storageChain = vi.hoisted(() => ({
  upload: vi.fn(),
}));

const supabaseChain = vi.hoisted(() => ({
  profileData: null,
  docData: null,
  maybeSingle: vi.fn(),
  select: vi.fn(),
}));

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  storage: { from: vi.fn(() => storageChain) },
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: supabaseMock,
  supabaseAdmin: null,
}));

const { default: digilockerService } = await import('../../src/services/digilockerService.js');

describe('digilockerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIGILOCKER_MOCK = 'true';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    delete process.env.DIGILOCKER_MOCK;
    delete process.env.NODE_ENV;
  });

  it('isMock is true when DIGILOCKER_MOCK is set', () => {
    expect(digilockerService.isMock).toBe(true);
  });

  it('isMock is false in production even when DIGILOCKER_MOCK is true', () => {
    process.env.NODE_ENV = 'production';
    expect(digilockerService.isMock).toBe(false);
  });

  it('exchangeCode returns a mock token in mock mode', async () => {
    const result = await digilockerService.exchangeCode('code-123');
    expect(result.access_token).toContain('mock_digilocker_token_');
    expect(result.digilocker_id).toContain('DLID_');
  });

  it('exchangeCode refuses without credentials when not in mock mode', async () => {
    process.env.DIGILOCKER_MOCK = 'false';
    const result = await digilockerService.exchangeCode('code-123');
    expect(result.success).toBe(false);
  });

  it('verifyDocuments returns verified documents in mock mode', async () => {
    supabaseMock.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: { polygon_wallet_address: null }, error: null }),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })),
    });

    const result = await digilockerService.verifyDocuments('user-1', 'mock-token');

    expect(result.success).toBe(true);
    expect(result.is_digilocker_verified).toBe(true);
    expect(result.verified_documents).toEqual(['driving_licence', 'rc_book', 'insurance']);
    expect(result.document_hash).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('verifyAndSyncDocuments syncs mock documents in mock mode', async () => {
    supabaseMock.from.mockImplementation((table) => {
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: { polygon_wallet_address: '0x0' }, error: null }),
            })),
          })),
        };
      }
      if (table === 'driver_documents') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              })),
            })),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: { id: 'doc-1' }, error: null }),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: { id: 'doc-1' }, error: null }),
              })),
            })),
          })),
        };
      }
      return {};
    });

    storageChain.upload.mockResolvedValue({ error: null });

    const result = await digilockerService.verifyAndSyncDocuments('driver-1', 'code');

    expect(result.success).toBe(true);
    expect(result.syncedDocumentsCount).toBeGreaterThan(0);
  });
});
