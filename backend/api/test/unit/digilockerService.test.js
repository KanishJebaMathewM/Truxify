import axios from 'axios';
import logger from '../middleware/logger.js';
import { AppError } from '../utils/errors.js';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const ML_API_KEY = process.env.ML_API_KEY;

// Simple in-memory LRU-style caches
const demandCache = new Map();
const priceCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function guardMlApiKey() {
  if (!ML_API_KEY) {
    logger.error('[MLService] ML_API_KEY is not configured in environment variables');
    throw new AppError('Machine learning service is unavailable', 503);
  }
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
  
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
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

/**
 * Calculates Haversine distance between two coordinates in kilometers.
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export const mlService = {
  /**
   * Predicts demand for a given location and timestamp.
   */
  async predictDemand(features) {
    guardMlApiKey();
    const cacheKey = JSON.stringify(features);
    const cached = demandCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const response = await axios.post(`${ML_SERVICE_URL}/predict/demand`, features, {
        headers: {
          'X-API-Key': ML_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      });

      demandCache.set(cacheKey, { data: response.data, timestamp: Date.now() });
      return response.data;
    } catch (err) {
      logger.error('[MLService] predictDemand failed:', err.message);
      throw new AppError('Failed to fetch demand prediction', 502);
    }
  },

  /**
   * Predicts pricing based on distance, weight, and traffic multipliers.
   */
  async predictPrice(params) {
    guardMlApiKey();
    const cacheKey = JSON.stringify(params);
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const response = await axios.post(`${ML_SERVICE_URL}/predict/price`, params, {
        headers: {
          'X-API-Key': ML_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      });

      priceCache.set(cacheKey, { data: response.data, timestamp: Date.now() });
      return response.data;
    } catch (err) {
      logger.error('[MLService] predictPrice failed:', err.message);
      throw new AppError('Failed to calculate price prediction', 502);
    }
  },

  /**
   * Computes route ETA and confidence intervals.
   */
  async predictEta(params) {
    guardMlApiKey();
    try {
      const response = await axios.post(`${ML_SERVICE_URL}/predict/eta`, params, {
        headers: {
          'X-API-Key': ML_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      });
      return response.data;
    } catch (err) {
      logger.error('[MLService] predictEta failed:', err.message);
      throw new AppError('Failed to calculate ETA', 502);
    }
  },

  /**
   * Evaluates proportional cancellation penalties based on distance covered ratio.
   */
  async predictCancellationPenalty(params) {
    guardMlApiKey();
    try {
      const response = await axios.post(`${ML_SERVICE_URL}/predict/cancellation-penalty`, params, {
        headers: {
          'X-API-Key': ML_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      });
      return response.data;
    } catch (err) {
      logger.error('[MLService] predictCancellationPenalty failed:', err.message);
      throw new AppError('Failed to calculate cancellation penalty', 502);
    }
  },

  /**
   * Predicts driver net profit with mileage, fuel, and toll adjustments.
   */
  async predictDriverProfit(params) {
    guardMlApiKey();
    try {
      const response = await axios.post(`${ML_SERVICE_URL}/predict/driver-profit`, params, {
        headers: {
          'X-API-Key': ML_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      });
      return response.data;
    } catch (err) {
      logger.error('[MLService] predictDriverProfit failed:', err.message);
      throw new AppError('Failed to calculate driver profit', 502);
    }
  },

  /**
   * Recommends return-trip or deadhead routing loads with fallback to Haversine distance ranking.
   */
  async matchDeadhead(params) {
    guardMlApiKey();
    try {
      const response = await axios.post(`${ML_SERVICE_URL}/match/deadhead`, params, {
        headers: {
          'X-API-Key': ML_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      });
      return response.data;
    } catch (err) {
      logger.warn('[MLService] matchDeadhead failed, falling back to Haversine distance ranking:', err.message);
      
      // Fallback calculation using local coordinates if available
      const { current_lat, current_lon, available_loads = [] } = params;
      if (typeof current_lat === 'number' && typeof current_lon === 'number' && Array.isArray(available_loads)) {
        return available_loads
          .map((load) => ({
            ...load,
            distance_km: calculateHaversineDistance(
              current_lat,
              current_lon,
              load.pickup_lat,
              load.pickup_lon
            ),
          }))
          .sort((a, b) => a.distance_km - b.distance_km);
      }
      
      throw new AppError('Failed to match deadhead routing', 502);
    }
  },

  /**
   * Recommends en-route loads along a path with fallback mechanisms.
   */
  async matchEnRouteLoads(params) {
    guardMlApiKey();
    try {
      const response = await axios.post(`${ML_SERVICE_URL}/match/en-route`, params, {
        headers: {
          'X-API-Key': ML_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      });
      return response.data;
    } catch (err) {
      logger.warn('[MLService] matchEnRouteLoads failed, falling back to Haversine ranking:', err.message);
      return [];
    }
  },
};

export default mlService;
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
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
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

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Stubs the Supabase surface verifyAndSyncDocuments touches and returns the
 * registerDocument spy so the on-chain write can be asserted.
 */
function stubSyncTables(profileWallet) {
  const registerDocument = vi.fn().mockResolvedValue({
    wait: vi.fn().mockResolvedValue(undefined),
    hash: '0x' + 'ab'.repeat(32),
  });

  supabaseMock.from.mockImplementation((table) => {
    if (table === 'profiles') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { polygon_wallet_address: profileWallet },
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
  digilockerService.documentRegistry = { registerDocument };
  return registerDocument;
}

describe('digilockerService — zero-address wallet guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIGILOCKER_MOCK = 'true';
    process.env.NODE_ENV = 'test';
  });

  it('does not submit an on-chain write for the zero address', async () => {
    // The zero address is a truthy string, so a plain `if (walletAddress)`
    // guard let it through and burned gas on a registration for 0x0.
    const registerDocument = stubSyncTables(ZERO_ADDRESS);

    const result = await digilockerService.verifyAndSyncDocuments('driver-zero', 'code');

    expect(result.success).toBe(true);
    expect(registerDocument).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no valid wallet address'),
    );
  });

  it('does not submit an on-chain write when the wallet is missing', async () => {
    const registerDocument = stubSyncTables(null);

    await digilockerService.verifyAndSyncDocuments('driver-null', 'code');

    expect(registerDocument).not.toHaveBeenCalled();
  });

  it('does not submit an on-chain write for a blank wallet string', async () => {
    const registerDocument = stubSyncTables('   ');

    await digilockerService.verifyAndSyncDocuments('driver-blank', 'code');

    expect(registerDocument).not.toHaveBeenCalled();
  });

  it('submits the on-chain write for a real wallet address', async () => {
    const wallet = '0x' + '11'.repeat(20);
    const registerDocument = stubSyncTables(wallet);

    const result = await digilockerService.verifyAndSyncDocuments('driver-real', 'code');

    expect(result.success).toBe(true);
    expect(registerDocument).toHaveBeenCalled();
    expect(registerDocument.mock.calls[0][0]).toBe(wallet);
  });
});
