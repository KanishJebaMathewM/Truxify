import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mocks with vi.hoisted so they're available for mocking
const { mockFrom, mockRedisGet, mockRedisSetex } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRedisGet: vi.fn(),
  mockRedisSetex: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: mockFrom },
  supabaseAdmin: { from: mockFrom },
  redisClient: {
    get: mockRedisGet,
    setex: mockRedisSetex,
  },
}));

// Mock logger to suppress logs during tests
vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Helper to create a chainable mock query builder
function chain(overrides = {}) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    count: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    ...overrides,
  };
}

describe('FraudDetectionService._flushPendingUpserts', () => {
  let FraudDetectionService;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    
    // Setup default mock - profile not found in DB
    mockFrom.mockReturnValue(chain({
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }));
    mockRedisGet.mockResolvedValue(null);
    
    FraudDetectionService = (await import('../../src/services/fraud/FraudDetectionService.js')).default;
    
    // Clear any pending data and intervals
    FraudDetectionService.pendingUpserts.clear();
    if (FraudDetectionService._flushInterval) {
      clearInterval(FraudDetectionService._flushInterval);
      FraudDetectionService._flushInterval = null;
    }
    if (FraudDetectionService._cleanupInterval) {
      clearInterval(FraudDetectionService._cleanupInterval);
      FraudDetectionService._cleanupInterval = null;
    }
  });

  async function trackOneUser(userId) {
    // Setup mocks for trackBehavior
    mockFrom.mockReturnValue(chain({
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }));
    mockRedisGet.mockResolvedValue(null);
    
    return FraudDetectionService.trackBehavior(userId, {
      type: 'transaction',
      amount: 100,
      transactionType: 'pay',
    });
  }

  it('retains pending risk-score updates when the DB upsert fails', async () => {
    await trackOneUser('user-flush');
    expect(FraudDetectionService.pendingUpserts.size).toBe(1);
    
    mockFrom.mockReturnValue(chain({
      upsert: vi.fn().mockResolvedValue({ error: { message: 'db unavailable' } }),
    }));
    
    await FraudDetectionService._flushPendingUpserts();
    expect(FraudDetectionService.pendingUpserts.size).toBe(1);
    expect(FraudDetectionService.pendingUpserts.has('user-flush')).toBe(true);
  });

  it('retains pending risk-score updates when the DB upsert throws', async () => {
    await trackOneUser('user-throw');
    expect(FraudDetectionService.pendingUpserts.size).toBe(1);
    
    mockFrom.mockReturnValue(chain({
      upsert: vi.fn().mockRejectedValue(new Error('network down')),
    }));
    
    await FraudDetectionService._flushPendingUpserts();
    expect(FraudDetectionService.pendingUpserts.size).toBe(1);
    expect(FraudDetectionService.pendingUpserts.has('user-throw')).toBe(true);
  });

  it('clears pending updates only after a successful DB upsert', async () => {
    await trackOneUser('user-ok');
    expect(FraudDetectionService.pendingUpserts.size).toBe(1);
    
    mockFrom.mockReturnValue(chain({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }));
    
    await FraudDetectionService._flushPendingUpserts();
    expect(FraudDetectionService.pendingUpserts.size).toBe(0);
  });
});
