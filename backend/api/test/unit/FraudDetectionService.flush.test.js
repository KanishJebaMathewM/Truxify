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
    FraudDetectionService.pendingRetries?.clear();
    FraudDetectionService.dlq = [];
    FraudDetectionService._consecutiveFlushFailures = 0;
    FraudDetectionService._nextFlushAllowedAt = 0;
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
      upsert: vi.fn().mockResolvedValue({ error: null }),
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

  it('preserves newer updates that arrive while a flush is in-flight', async () => {
    await trackOneUser('user-concurrent');
    expect(FraudDetectionService.pendingUpserts.size).toBe(1);

    let resolveUpsert;
    const upsertPromise = new Promise((resolve) => {
      resolveUpsert = resolve;
    });

    mockFrom.mockReturnValue(chain({
      upsert: vi.fn().mockImplementation(() => upsertPromise),
    }));

    const flushPromise = FraudDetectionService._flushPendingUpserts();

    // While flush is in flight, a newer update arrives for the same user
    const newerRecord = {
      user_id: 'user-concurrent',
      events: [{ type: 'transaction', amount: 999 }],
      patterns: {},
      last_activity: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    FraudDetectionService.pendingUpserts.set('user-concurrent', newerRecord);

    // Resolve the in-flight upsert
    resolveUpsert({ error: null });
    await flushPromise;

    // The newer record must remain pending and NOT be cleared
    expect(FraudDetectionService.pendingUpserts.size).toBe(1);
    expect(FraudDetectionService.pendingUpserts.get('user-concurrent')).toBe(newerRecord);
  });

  it('increments retry count on failure and calculates bounded backoff', async () => {
    await trackOneUser('user-retry');
    expect(FraudDetectionService.pendingRetries.get('user-retry') || 0).toBe(0);

    mockFrom.mockReturnValue(chain({
      upsert: vi.fn().mockResolvedValue({ error: { message: 'temporary network failure' } }),
    }));

    await FraudDetectionService._flushPendingUpserts();

    expect(FraudDetectionService.pendingRetries.get('user-retry')).toBe(1);
    expect(FraudDetectionService._consecutiveFlushFailures).toBe(1);
    expect(FraudDetectionService._nextFlushAllowedAt).toBeGreaterThan(Date.now());
  });

  it('routes permanently failing records to DLQ after exceeding max retries', async () => {
    await trackOneUser('user-dlq');
    FraudDetectionService.maxFlushRetries = 3;

    mockFrom.mockReturnValue(chain({
      upsert: vi.fn().mockResolvedValue({ error: { message: 'deadlock detected' } }),
    }));

    // Fail 3 times to exhaust retries
    await FraudDetectionService._flushPendingUpserts();
    expect(FraudDetectionService.pendingRetries.get('user-dlq')).toBe(1);

    await FraudDetectionService._flushPendingUpserts();
    expect(FraudDetectionService.pendingRetries.get('user-dlq')).toBe(2);

    await FraudDetectionService._flushPendingUpserts();

    // After 3rd failure, the item should be removed from pendingUpserts and routed to dlq
    expect(FraudDetectionService.pendingUpserts.has('user-dlq')).toBe(false);
    expect(FraudDetectionService.dlq.length).toBe(1);
    expect(FraudDetectionService.dlq[0].userId).toBe('user-dlq');
    expect(FraudDetectionService.dlq[0].retries).toBe(3);
    expect(FraudDetectionService.dlq[0].error).toContain('deadlock');
  });

  it('trackBehavior returns acknowledged and persisted status', async () => {
    mockFrom.mockReturnValue(chain({
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }));
    mockRedisGet.mockResolvedValue(null);

    const result = await FraudDetectionService.trackBehavior('user-status', {
      type: 'transaction',
      amount: 42,
    });

    expect(result).toHaveProperty('userId', 'user-status');
    expect(result).toHaveProperty('acknowledged', true);
    expect(result).toHaveProperty('persisted', true);
    expect(result).toHaveProperty('riskScore');
    expect(result).toHaveProperty('profile');
  });
});
