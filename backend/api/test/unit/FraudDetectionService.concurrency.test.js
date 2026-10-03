import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
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

describe('FraudDetectionService Concurrency', () => {
  let FraudDetectionService;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();

    mockFrom.mockReturnValue(chain({
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }));
    mockRedisGet.mockResolvedValue(null);
    mockRedisSetex.mockResolvedValue('OK');

    FraudDetectionService = (await import('../../src/services/fraud/FraudDetectionService.js')).default;
    FraudDetectionService.pendingUpserts.clear();
    FraudDetectionService.behavioralProfiles.clear();
    if (FraudDetectionService._flushInterval) {
      clearInterval(FraudDetectionService._flushInterval);
      FraudDetectionService._flushInterval = null;
    }
  });

  it('serializes concurrent trackBehavior calls for the same user and preserves all events', async () => {
    const userId = 'user-race-test';

    // Simulate in-memory profile persistence across the two calls
    let storedProfile = null;
    mockRedisGet.mockImplementation(async () => {
      return storedProfile ? JSON.stringify(storedProfile) : null;
    });
    mockRedisSetex.mockImplementation(async (key, ttl, val) => {
      storedProfile = JSON.parse(val);
      return 'OK';
    });

    // Launch two concurrent trackBehavior calls simultaneously
    const [result1, result2] = await Promise.all([
      FraudDetectionService.trackBehavior(userId, {
        type: 'transaction',
        amount: 100,
        desc: 'first-event',
      }),
      FraudDetectionService.trackBehavior(userId, {
        type: 'transaction',
        amount: 200,
        desc: 'second-event',
      }),
    ]);

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result1.acknowledged).toBe(true);
    expect(result2.acknowledged).toBe(true);

    // Verify that storedProfile has captured BOTH events
    expect(storedProfile).not.toBeNull();
    expect(storedProfile.events.length).toBe(2);

    const eventDescs = storedProfile.events.map(e => e.data.desc);
    expect(eventDescs).toContain('first-event');
    expect(eventDescs).toContain('second-event');

    // Verify pendingUpserts has the final combined state with both events
    const pending = FraudDetectionService.pendingUpserts.get(userId);
    expect(pending).toBeDefined();
    expect(pending.events.length).toBe(2);
  });

  it('allows concurrent trackBehavior calls for distinct users to process independently', async () => {
    const userA = 'user-A';
    const userB = 'user-B';

    const [resA, resB] = await Promise.all([
      FraudDetectionService.trackBehavior(userA, {
        type: 'location',
        lat: 19.076,
        lng: 72.878,
      }),
      FraudDetectionService.trackBehavior(userB, {
        type: 'typing',
        wpm: 85,
      }),
    ]);

    expect(resA.userId).toBe(userA);
    expect(resB.userId).toBe(userB);

    expect(FraudDetectionService.pendingUpserts.has(userA)).toBe(true);
    expect(FraudDetectionService.pendingUpserts.has(userB)).toBe(true);
    expect(FraudDetectionService.pendingUpserts.size).toBe(2);
  });

  it('handles 5 concurrent events for the same user without dropping any event', async () => {
    const userId = 'user-high-concurrency';
    let storedProfile = null;
    mockRedisGet.mockImplementation(async () => {
      return storedProfile ? JSON.stringify(storedProfile) : null;
    });
    mockRedisSetex.mockImplementation(async (key, ttl, val) => {
      storedProfile = JSON.parse(val);
      return 'OK';
    });

    const promises = Array.from({ length: 5 }, (_, i) =>
      FraudDetectionService.trackBehavior(userId, {
        type: 'mouse',
        idx: i,
      })
    );

    const results = await Promise.all(promises);
    expect(results.every(r => r && r.acknowledged)).toBe(true);

    expect(storedProfile.events.length).toBe(5);
    const indices = storedProfile.events.map(e => e.data.idx).sort((a, b) => a - b);
    expect(indices).toEqual([0, 1, 2, 3, 4]);
  });
});
