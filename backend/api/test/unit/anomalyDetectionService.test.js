import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              gte: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                })),
              })),
            })),
          })),
        })),
      })),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
      })),
    })),
  },
}));

vi.mock('../../src/config/db.js', () => ({
  
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
  supabase: mockSupabase,
  supabaseAdmin: mockSupabase,
}));

vi.mock('../../src/core/performanceMetrics.js', () => ({
  measureExecution: vi.fn(async (name, fn) => fn()),
}));

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}));

import AnomalyDetectionService, {
  ANOMALY_THRESHOLDS,
  ANOMALY_SEVERITY,
} from '../../src/services/security/anomalyDetectionService.js';

describe('AnomalyDetectionService', () => {
  let service;
  let mockAlertRouter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAlertRouter = {
      route: vi.fn().mockResolvedValue([]),
    };
    service = new AnomalyDetectionService({
      alertRouter: mockAlertRouter,
      maxBehavioralProfiles: 5,
      evictionFraction: 0.4,
    });
  });

  describe('isWithdrawalDirection', () => {
    it('correctly identifies withdrawal transactions case-insensitively', () => {
      expect(service.isWithdrawalDirection({ type: 'withdrawal' })).toBe(true);
      expect(service.isWithdrawalDirection({ type: 'WITHDRAWAL' })).toBe(true);
      expect(service.isWithdrawalDirection({ type: 'Withdrawal' })).toBe(true);
    });

    it('returns false for deposits, transfers, and undefined types', () => {
      expect(service.isWithdrawalDirection({ type: 'deposit' })).toBe(false);
      expect(service.isWithdrawalDirection({ type: 'transfer' })).toBe(false);
      expect(service.isWithdrawalDirection({})).toBe(false);
      expect(service.isWithdrawalDirection(null)).toBe(false);
    });
  });

  describe('detectUnusualTime', () => {
    it('detects transactions occurring during unusual UTC hours (0 to 6)', () => {
      const tx = { timestamp: '2026-09-15T02:30:00.000Z' };
      const anomaly = service.detectUnusualTime(tx);

      expect(anomaly).toBeDefined();
      expect(anomaly.type).toBe('UNUSUAL_TIME');
      expect(anomaly.severity).toBe('LOW');
      expect(anomaly.message).toContain('2:00 UTC');
    });

    it('returns null for transactions during normal business/daytime UTC hours', () => {
      const tx = { timestamp: '2026-09-15T14:15:00.000Z' };
      expect(service.detectUnusualTime(tx)).toBeNull();
    });
  });

  describe('calculateRiskLevel', () => {
    it('returns LOW when no anomalies are present', () => {
      expect(service.calculateRiskLevel([])).toBe('LOW');
    });

    it('evaluates CRITICAL, HIGH, and MEDIUM severities properly', () => {
      expect(service.calculateRiskLevel([{ severity: 'CRITICAL' }, { severity: 'LOW' }])).toBe('CRITICAL');
      expect(service.calculateRiskLevel([{ severity: 'HIGH' }, { severity: 'MEDIUM' }])).toBe('HIGH');
      expect(service.calculateRiskLevel([{ severity: 'MEDIUM' }])).toBe('MEDIUM');
      expect(service.calculateRiskLevel([{ severity: 'LOW' }])).toBe('LOW');
    });
  });

  describe('shouldBlockTransaction', () => {
    it('returns true when a LARGE_WITHDRAWAL or CRITICAL anomaly is flagged', () => {
      expect(service.shouldBlockTransaction([{ type: 'LARGE_WITHDRAWAL', severity: 'HIGH' }])).toBe(true);
      expect(service.shouldBlockTransaction([{ type: 'OTHER', severity: 'CRITICAL' }])).toBe(true);
    });

    it('returns false for non-blocking anomalies like UNUSUAL_TIME or MEDIUM transfers', () => {
      expect(service.shouldBlockTransaction([{ type: 'UNUSUAL_TIME', severity: 'LOW' }])).toBe(false);
      expect(service.shouldBlockTransaction([{ type: 'MULTIPLE_TRANSFERS', severity: 'MEDIUM' }])).toBe(false);
    });
  });

  describe('detectLargeWithdrawal', () => {
    it('returns null immediately if transaction is not a withdrawal', async () => {
      const depositTx = { type: 'deposit', amount: 50000 };
      const result = await service.detectLargeWithdrawal('usr-1', '0x123', depositTx);
      expect(result).toBeNull();
    });
  });

  describe('triggerSecurityAlert', () => {
    it('routes security alerts through alertRouter when configured', async () => {
      const anomalies = [{ type: 'LARGE_WITHDRAWAL', severity: 'HIGH' }];
      await service.triggerSecurityAlert('usr-1', '0xabc', anomalies, 'HIGH');

      expect(mockAlertRouter.route).toHaveBeenCalledTimes(1);
      expect(mockAlertRouter.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'WALLET_ANOMALY_DETECTED',
          severity: 'HIGH',
          userId: 'usr-1',
          walletAddress: '0xabc',
        })
      );
    });
  });

  describe('detectAnomaly', () => {
    it('identifies normal behavior when speed is within acceptable thresholds', () => {
      const now = Date.now();
      // Moving ~55 km in 1 hour (~55 km/h)
      const locations = [
        { lat: 18.5204, lng: 73.8567, timestamp: now - 3600000 }, // Pune
        { lat: 18.9000, lng: 74.2000, timestamp: now },
      ];

      const result = service.detectAnomaly({ locationHistory: locations });

      expect(result.isAnomaly).toBe(false);
      expect(result.anomaly).toBe(false);
      expect(result.message).toBe('Normal behavior');
    });

    it('detects an anomaly when impossible travel speed is calculated', () => {
      const now = Date.now();
      // Moving from Mumbai to Delhi (~1150 km) in 1 hour (~1150 km/h)
      const locations = [
        { lat: 19.0760, lng: 72.8777, timestamp: now - 3600000 }, // Mumbai
        { lat: 28.7041, lng: 77.1025, timestamp: now },           // Delhi
      ];

      const result = service.detectAnomaly({ locationHistory: locations });

      expect(result.isAnomaly).toBe(true);
      expect(result.anomaly).toBe(true);
      expect(result.type).toBe('IMPOSSIBLE_SPEED');
      expect(result.speedKmh).toBeGreaterThan(150);
      expect(result.message).toContain('Impossible speed detected');
    });

    it('detects zero-time teleportation between distinct geographic coordinates', () => {
      const now = Date.now();
      const locations = [
        { lat: 19.0760, lng: 72.8777, timestamp: now },
        { lat: 28.7041, lng: 77.1025, timestamp: now }, // same timestamp, different place
      ];

      const result = service.detectAnomaly({ locationHistory: locations });

      expect(result.isAnomaly).toBe(true);
      expect(result.type).toBe('IMPOSSIBLE_SPEED');
      expect(result.reason).toContain('teleportation');
    });

    it('handles insufficient data gracefully when fewer than 2 locations are provided', () => {
      expect(service.detectAnomaly({ locationHistory: [] })).toEqual({
        isAnomaly: false,
        anomaly: false,
        reason: 'INSUFFICIENT_DATA',
        confidence: 0,
        message: expect.stringContaining('Insufficient'),
      });

      expect(service.detectAnomaly({ locationHistory: [{ lat: 19.0, lng: 72.0, timestamp: Date.now() }] })).toEqual({
        isAnomaly: false,
        anomaly: false,
        reason: 'INSUFFICIENT_DATA',
        confidence: 0,
        message: expect.stringContaining('Insufficient'),
      });

      expect(service.detectAnomaly(null)).toEqual({
        isAnomaly: false,
        anomaly: false,
        reason: 'INSUFFICIENT_DATA',
        confidence: 0,
      });
    });

    it('detects anomaly for a recorded user profile by userId', () => {
      const now = Date.now();
      service.recordBehavior('driver-spoof', {
        locationHistory: [
          { lat: 12.9716, lng: 77.5946, timestamp: now - 1800000 }, // Bangalore
          { lat: 28.7041, lng: 77.1025, timestamp: now },           // Delhi (1700km in 30 min)
        ],
      });

      const result = service.detectAnomaly('driver-spoof');
      expect(result.isAnomaly).toBe(true);
      expect(result.type).toBe('IMPOSSIBLE_SPEED');
    });
  });

  describe('recordBehavior and profile retrieval', () => {
    it('creates and retrieves behavioral profiles for users', () => {
      const profile = service.recordBehavior('user-42', {
        lat: 19.0760,
        lng: 72.8777,
        event: { type: 'login' },
      });

      expect(profile).toBeDefined();
      expect(profile.userId).toBe('user-42');
      expect(profile.events).toHaveLength(1);
      expect(profile.patterns.locationHistory).toHaveLength(1);

      const retrieved = service.getBehaviorProfile('user-42');
      expect(retrieved).toBe(profile);
    });

    it('appends behavior updates to existing user profile', () => {
      service.recordBehavior('user-42', { lat: 19.0, lng: 72.0 });
      service.recordBehavior('user-42', { lat: 19.1, lng: 72.1 });

      const profile = service.getBehaviorProfile('user-42');
      expect(profile.patterns.locationHistory).toHaveLength(2);
    });

    it('returns null when recording or retrieving with invalid userId', () => {
      expect(service.recordBehavior(null)).toBeNull();
      expect(service.getBehaviorProfile(null)).toBeNull();
      expect(service.getBehaviorProfile('non-existent')).toBeNull();
    });
  });

  describe('LRU _evictFromMap eviction logic', () => {
    it('does not evict when map size is at or below maxSize', () => {
      const map = new Map([
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ]);

      const evicted = service._evictFromMap(map, 5, 'test items');
      expect(evicted).toBe(0);
      expect(map.size).toBe(3);
    });

    it('evicts oldest entries when map exceeds maxSize', () => {
      const map = new Map([
        ['k1', 'val1'],
        ['k2', 'val2'],
        ['k3', 'val3'],
        ['k4', 'val4'],
        ['k5', 'val5'],
        ['k6', 'val6'],
      ]);

      // maxSize is 4, evictionFraction is 0.4 => floor(6 * 0.4) = 2 entries deleted
      const evicted = service._evictFromMap(map, 4, 'cache items');

      expect(evicted).toBe(2);
      expect(map.has('k1')).toBe(false);
      expect(map.has('k2')).toBe(false);
      expect(map.has('k3')).toBe(true);
      expect(map.has('k6')).toBe(true);
      expect(map.size).toBe(4);
    });

    it('automatically triggers eviction when behavioralProfiles map exceeds maxBehavioralProfiles', () => {
      // service initialized with maxBehavioralProfiles = 5
      for (let i = 1; i <= 6; i++) {
        service.recordBehavior(`driver-${i}`, { lat: 10 + i, lng: 70 + i });
      }

      // After adding 6 items to a max-5 map, oldest items should have been evicted
      expect(service.behavioralProfiles.size).toBeLessThanOrEqual(5);
      expect(service.behavioralProfiles.has('driver-1')).toBe(false);
      expect(service.behavioralProfiles.has('driver-6')).toBe(true);
    });
  });

  describe('calculateDistance helper', () => {
    it('calculates great-circle distance accurately between two GPS coordinates', () => {
      // Mumbai (19.0760, 72.8777) to Pune (18.5204, 73.8567) is approx 120-130 km
      const distance = service.calculateDistance(19.0760, 72.8777, 18.5204, 73.8567);
      expect(distance).toBeGreaterThan(110);
      expect(distance).toBeLessThan(140);
    });
  });

  describe('constants export', () => {
    it('exports ANOMALY_THRESHOLDS and ANOMALY_SEVERITY constants', () => {
      expect(ANOMALY_THRESHOLDS.LARGE_WITHDRAWAL).toBe(1000);
      expect(ANOMALY_SEVERITY.CRITICAL).toBe('CRITICAL');
    });
  });
});
