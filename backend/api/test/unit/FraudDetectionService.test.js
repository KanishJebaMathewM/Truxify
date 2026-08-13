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

const EMPTY_PATTERNS = {
  typingSpeed: [],
  mouseMovements: [],
  deviceFingerprint: null,
  locationHistory: [],
  transactionPatterns: [],
};

describe('FraudDetectionService', () => {
  let FraudDetectionService;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    FraudDetectionService = (await import('../../src/services/fraud/FraudDetectionService.js')).default;
  });

  describe('getFraudStats', () => {
    it('returns fraud statistics summary', async () => {
      mockFrom.mockReturnValue(chain({
        range: vi.fn().mockResolvedValue({
          data: [{ risk_score: 0.9 }, { risk_score: 0.2 }],
          error: null,
        }),
      }));

      const stats = await FraudDetectionService.getFraudStats();
      expect(stats.total).toBe(2);
      expect(stats.highRisk).toBe(1);
      expect(stats.lowRisk).toBe(1);
    });
  });

  describe('getOrCreateProfile', () => {
    it('returns existing profile when found', async () => {
      const mockProfile = { user_id: 'user-1', fraud_score: 0.2, risk_level: 'low' };
      mockFrom.mockReturnValue(chain({
        single: vi.fn().mockResolvedValue({ data: mockProfile, error: null }),
      }));

      const profile = await FraudDetectionService.getOrCreateProfile('user-1');
      expect(profile.user_id).toBe('user-1');
    });

    it('creates a new profile when not found', async () => {
      mockFrom.mockReturnValue(chain({
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
      }));

      const profile = await FraudDetectionService.getOrCreateProfile('user-new');
      expect(profile.userId).toBe('user-new');
      expect(profile.patterns).toEqual(EMPTY_PATTERNS);
      expect(profile.events).toEqual([]);
    });
  });

  describe('calculateBehavioralRisk', () => {
    it('returns zero risk for a profile with no flags', async () => {
      const profile = { user_id: 'user-1', fraud_score: 0.1, risk_level: 'low', events: [], patterns: EMPTY_PATTERNS };

      const risk = await FraudDetectionService.calculateBehavioralRisk(profile);
      expect(risk).toBe(0);
    });

    it('returns high risk when suspicious patterns are detected', async () => {
      const profile = {
        user_id: 'user-suspicious',
        fraud_score: 0.9,
        risk_level: 'high',
        events: [],
        patterns: {
          ...EMPTY_PATTERNS,
          typingSpeed: Array.from({ length: 12 }, (_, i) => ({ speed: i % 2 === 0 ? 10 : 90, timestamp: i })),
          locationHistory: Array.from({ length: 11 }, (_, i) => ({
            lat: 28.6 + i * 0.001,
            lng: 77.2 + i * 0.001,
            timestamp: i * 1000,
          })),
          transactionPatterns: Array.from({ length: 12 }, (_, i) => ({ amount: i === 11 ? 1000 : 100, timestamp: i })),
        },
      };

      const risk = await FraudDetectionService.calculateBehavioralRisk(profile);
      expect(risk).toBeGreaterThan(0.5);
    });
  });

  describe('analyzeNetwork', () => {
    it('returns network risk assessment', async () => {
      mockFrom
        .mockReturnValueOnce(chain({
          range: vi.fn().mockResolvedValue({ data: [], error: null }),
        }))
        .mockReturnValueOnce(chain({
          range: vi.fn().mockResolvedValue({ data: [], error: null }),
        }));

      const network = await FraudDetectionService.analyzeNetwork('user-1');
      expect(network).toHaveProperty('networkRisk');
      expect(network).toHaveProperty('isInFraudRing');
      expect(network.connections).toBe(0);
    });

    it('reports direct connections without fabricating a fraud ring', async () => {
      mockFrom
        .mockReturnValueOnce(chain({
          range: vi.fn().mockResolvedValue({
            data: [
              { customer_id: 'user-ring', driver_id: 'neighbor-1' },
              { customer_id: 'user-ring', driver_id: 'neighbor-2' },
              { customer_id: 'user-ring', driver_id: 'neighbor-3' },
            ],
            error: null,
          }),
        }))
        .mockReturnValueOnce(chain({
          range: vi.fn().mockResolvedValue({ data: [], error: null }),
        }));

      const network = await FraudDetectionService.analyzeNetwork('user-ring');
      expect(network.connections).toBe(3);
      expect(network.isInFraudRing).toBe(false);
    });
  });

  describe('_flushPendingUpserts', () => {
    function makeProfile(userId) {
      return {
        user_id: userId,
        events: [{ type: 'typing', timestamp: Date.now(), data: {} }],
        patterns: {
          typingSpeed: [],
          mouseMovements: [],
          deviceFingerprint: null,
          locationHistory: [],
          transactionPatterns: [],
        },
        last_activity: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }

    it('retains pending upserts when the DB upsert fails so they are retried', async () => {
      mockFrom.mockReturnValue(chain({
        upsert: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'connection reset' },
        }),
      }));

      FraudDetectionService.pendingUpserts.set('user-fail', makeProfile('user-fail'));

      await FraudDetectionService._flushPendingUpserts();

      // The failed entry must NOT be lost — it stays in the map for retry.
      expect(FraudDetectionService.pendingUpserts.size).toBe(1);
      expect(FraudDetectionService.pendingUpserts.has('user-fail')).toBe(true);

      // On the next flush, with a healthy DB, the entry is persisted and cleared.
      mockFrom.mockReturnValue(chain({
        upsert: vi.fn().mockResolvedValue({ data: [], error: null }),
      }));

      await FraudDetectionService._flushPendingUpserts();

      expect(FraudDetectionService.pendingUpserts.size).toBe(0);
    });

    it('keeps a newer pending update that arrives during a successful flush', async () => {
      let resolveUpsert;
      mockFrom.mockReturnValue(chain({
        upsert: vi.fn().mockImplementation(() => new Promise((res) => {
          resolveUpsert = () => res({ data: [], error: null });
        })),
      }));

      FraudDetectionService.pendingUpserts.set('user-race', makeProfile('user-race'));
      const flushPromise = FraudDetectionService._flushPendingUpserts();

      // A newer update for the same user replaces the snapshot entry.
      FraudDetectionService.pendingUpserts.set('user-race', makeProfile('user-race'));

      resolveUpsert();
      await flushPromise;

      // The older snapshot was persisted; the newer in-flight update must remain.
      expect(FraudDetectionService.pendingUpserts.size).toBe(1);
      expect(FraudDetectionService.pendingUpserts.has('user-race')).toBe(true);
    });
  });
});
