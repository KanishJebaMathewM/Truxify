/**
 * Unit tests for backend/api/src/services/digilockerService.js
 *
 * Coverage:
 *   - validateSetup: returns false when contracts not configured
 *   - validateSetup: returns true when both contracts respond to probes
 *   - validateSetup: returns false when a contract is missing bytecode
 *   - validateSetup: returns false when a contract ABI probe fails
 *   - isMock: true when DIGILOCKER_MOCK is set; false in production guard
 *   - exchangeCode: mock token in mock mode; live OAuth exchange; network error handling; refusal without credentials
 *   - verifyDocuments: verified documents in mock mode; missing token; non-mock rejection; error handling
 *   - verifyAndSyncDocuments: syncs mock documents; live document fetching and sync; network & storage error handling
 *
 * Run with:  npx vitest run test/unit/digilockerService.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const mockAxios = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
}));

vi.mock('axios', () => ({
  default: mockAxios,
}));

const storageChain = vi.hoisted(() => ({
  upload: vi.fn(),
}));

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  storage: { from: vi.fn(() => storageChain) },
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: supabaseMock,
  supabaseAdmin: supabaseMock,
}));

const { default: digilockerService } = await import('../../src/services/digilockerService.js');

function unsetContractEnv() {
  delete process.env.POLYGON_RPC_URL;
  delete process.env.RELAYER_WALLET_PRIVATE_KEY;
  delete process.env.PRIVATE_KEY;
  delete process.env.DOCUMENT_REGISTRY_CONTRACT;
  delete process.env.KYC_VERIFIER_CONTRACT_ADDRESS;
}

function setContractEnv() {
  process.env.POLYGON_RPC_URL = 'https://polygon-rpc.com';
  process.env.RELAYER_WALLET_PRIVATE_KEY = '0x' + '11'.repeat(32);
  process.env.DOCUMENT_REGISTRY_CONTRACT = '0x' + '22'.repeat(20);
  process.env.KYC_VERIFIER_CONTRACT_ADDRESS = '0x' + '33'.repeat(20);
}

async function loadService() {
  vi.resetModules();
  const mod = await import('../../src/services/digilockerService.js');
  return mod.default;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
});

describe('digilockerService — validateSetup (contracts unconfigured)', () => {
  it('returns false when env vars are missing', async () => {
    unsetContractEnv();
    const service = await loadService();
    expect(await service.validateSetup()).toBe(false);
  });
});

describe('digilockerService — validateSetup (contracts configured)', () => {
  it('returns true when both contracts have bytecode and respond to probes', async () => {
    setContractEnv();
    const service = await loadService();

    expect(service.documentRegistry).toBeTruthy();
    expect(service.kycVerifier).toBeTruthy();

    const provider = service.documentRegistry.runner.provider;
    vi.spyOn(provider, 'getCode').mockResolvedValue('0x12345678');
    vi.spyOn(service.documentRegistry, 'getDocument').mockResolvedValue([
      '0x' + '00'.repeat(32),
      '',
      0n,
      false
    ]);
    vi.spyOn(service.kycVerifier, 'isVerified').mockResolvedValue(false);

    expect(await service.validateSetup()).toBe(true);
  });

  it('returns false when a contract has no bytecode at the configured address', async () => {
    setContractEnv();
    const service = await loadService();

    const provider = service.documentRegistry.runner.provider;
    vi.spyOn(provider, 'getCode').mockResolvedValue('0x');
    vi.spyOn(service.documentRegistry, 'getDocument').mockResolvedValue([]);
    vi.spyOn(service.kycVerifier, 'isVerified').mockResolvedValue(false);

    expect(await service.validateSetup()).toBe(false);
  });

  it('returns false when the ABI probe fails (address points at the wrong contract)', async () => {
    setContractEnv();
    const service = await loadService();

    const provider = service.documentRegistry.runner.provider;
    vi.spyOn(provider, 'getCode').mockResolvedValue('0x12345678');
    vi.spyOn(service.documentRegistry, 'getDocument').mockRejectedValue(
      new Error('missing revert data in call exception')
    );
    vi.spyOn(service.kycVerifier, 'isVerified').mockResolvedValue(false);

    expect(await service.validateSetup()).toBe(false);
  });
});

describe('digilockerService — mock mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIGILOCKER_MOCK = 'true';
    process.env.NODE_ENV = 'test';
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
    expect(result.name).toBe('Suresh Kumar');
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

describe('digilockerService — live OAuth & error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIGILOCKER_MOCK = 'false';
    process.env.NODE_ENV = 'test';
    process.env.DIGILOCKER_CLIENT_ID = 'test-client-id';
    process.env.DIGILOCKER_CLIENT_SECRET = 'test-client-secret';
    process.env.DIGILOCKER_REDIRECT_URI = 'https://app.truxify.com/callback';
  });

  it('exchangeCode refuses when credentials or code are missing', async () => {
    const service = await loadService();
    const result = await service.exchangeCode('');
    expect(result.success).toBe(false);
    expect(result.error).toBe('DigiLocker verification is not configured');
  });

  it('exchangeCode successfully exchanges code for token via OAuth API', async () => {
    mockAxios.post.mockResolvedValueOnce({
      data: {
        access_token: 'live-access-token-xyz',
        digilockerid: 'DLID_9999',
        name: 'John Doe',
      },
    });

    const service = await loadService();
    const result = await service.exchangeCode('valid-auth-code');

    expect(result.access_token).toBe('live-access-token-xyz');
    expect(result.digilocker_id).toBe('DLID_9999');
    expect(result.name).toBe('John Doe');
    expect(mockAxios.post).toHaveBeenCalledWith(
      'https://api.digitallocker.gov.in/public/oauth2/1/token',
      expect.objectContaining({
        code: 'valid-auth-code',
        grant_type: 'authorization_code',
        client_id: 'test-client-id',
      }),
      expect.any(Object)
    );
  });

  it('exchangeCode handles network/API errors gracefully', async () => {
    mockAxios.post.mockRejectedValueOnce(new Error('Network connection timeout'));

    const service = await loadService();
    const result = await service.exchangeCode('some-auth-code');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network connection timeout');
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('verifyDocuments returns error when accessToken is missing', async () => {
    const result = await digilockerService.verifyDocuments('user-1', null);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Access token is required');
    expect(result.is_digilocker_verified).toBe(false);
  });

  it('verifyDocuments refuses auto-approval when not in mock mode', async () => {
    const service = await loadService();
    const result = await service.verifyDocuments('user-1', 'some-token');
    expect(result.success).toBe(false);
    expect(result.error).toBe('DigiLocker verification is not configured');
    expect(result.is_digilocker_verified).toBe(false);
  });

  it('verifyAndSyncDocuments throws error when token exchange network request fails', async () => {
    mockAxios.post.mockRejectedValueOnce(new Error('OAuth server unreachable'));

    const service = await loadService();
    await expect(service.verifyAndSyncDocuments('driver-1', 'auth-code')).rejects.toThrow(
      /Digilocker token exchange failed: OAuth server unreachable/
    );
  });

  it('verifyAndSyncDocuments throws error when issued documents fetch fails', async () => {
    mockAxios.post.mockResolvedValueOnce({
      data: { access_token: 'valid-token', digilockerid: 'DLID_1' },
    });
    mockAxios.get.mockRejectedValueOnce(new Error('API rate limited'));

    const service = await loadService();
    await expect(service.verifyAndSyncDocuments('driver-1', 'auth-code')).rejects.toThrow(
      /Failed to fetch DigiLocker documents: API rate limited/
    );
  });

  it('verifyAndSyncDocuments successfully fetches, parses, and syncs issued documents in live mode', async () => {
    mockAxios.post.mockResolvedValueOnce({
      data: { access_token: 'valid-token', digilockerid: 'DLID_1' },
    });
    mockAxios.get
      .mockResolvedValueOnce({
        data: {
          items: [
            { doctype: 'DRVLC', uri: 'in.gov.transport-DRVLC-1234' },
            { doctype: 'ADLNK', uri: 'in.gov.transport-ADLNK-5678' },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: { licenceNumber: 'DL123', holder: 'Test Driver' },
      })
      .mockResolvedValueOnce({
        data: JSON.stringify({ registrationNumber: 'GJ01AB1234', owner: 'Test Driver' }),
      });

    supabaseMock.from.mockImplementation((table) => {
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { polygon_wallet_address: '0x1111111111111111111111111111111111111111' },
                error: null,
              }),
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
              single: vi.fn().mockResolvedValue({ data: { id: 'doc-sync-1' }, error: null }),
            })),
          })),
        };
      }
      return {};
    });

    storageChain.upload.mockResolvedValue({ error: null });

    const service = await loadService();
    const result = await service.verifyAndSyncDocuments('driver-1', 'auth-code');

    expect(result.success).toBe(true);
    expect(result.syncedDocumentsCount).toBe(2);
    expect(result.isMock).toBe(false);
  });
});
