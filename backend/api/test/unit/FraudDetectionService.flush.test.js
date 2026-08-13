import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
const mockRedisGet = vi.fn();
const mockRedisSetex = vi.fn();

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: mockFrom },
  supabaseAdmin: { from: mockFrom },
  redisClient: {
    get: mockRedisGet,
    setex: mockRedisSetex,
  },
}));

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
    FraudDetectionService = (await import('../../src/services/fraud/FraudDetectionService.js')).default;
    // Stop the background intervals so they don't flush/clear state mid-test.
    clearInterval(FraudDetectionService._flushInterval);
    clearInterval(FraudDetectionService._cleanupInterval);
  });

  async function trackOneUser(userId) {
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
