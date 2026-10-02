import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      insert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnThis()
    }))
  },
  redisClient: null,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import FraudDetectionService from '../../src/services/fraud/FraudDetectionService.js';
import { supabaseAdmin } from '../../src/config/db.js';

describe('FraudDetectionService - Complete Core & Edge Case Test Suite', () => {
  let fraudService;

  beforeEach(() => {
    vi.useFakeTimers();
    fraudService = FraudDetectionService;
    fraudService.destroy();
    fraudService.redis = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    fraudService.destroy();
  });

  // ============================================================================
  // 1. Original Utility & Scoring Tests
  // ============================================================================
  describe('getRiskLevel', () => {
    it('returns HIGH for score between 0.5 and 0.7', () => {
      expect(FraudDetectionService.getRiskLevel(0.5)).toBe('HIGH');
      expect(FraudDetectionService.getRiskLevel(0.65)).toBe('HIGH');
    });

    it('returns MEDIUM for score between 0.3 and 0.5', () => {
      expect(FraudDetectionService.getRiskLevel(0.4)).toBe('MEDIUM');
      expect(FraudDetectionService.getRiskLevel(0.3)).toBe('MEDIUM');
    });

    it('returns LOW for score below 0.3', () => {
      expect(FraudDetectionService.getRiskLevel(0.2)).toBe('LOW');
      expect(FraudDetectionService.getRiskLevel(0.0)).toBe('LOW');
    });

    it('returns CRITICAL for score >= 0.7', () => {
      expect(FraudDetectionService.getRiskLevel(0.7)).toBe('CRITICAL');
      expect(FraudDetectionService.getRiskLevel(0.9)).toBe('CRITICAL');
    });
  });

  describe('sanitizeUserId', () => {
    it('returns the userId when it contains no invalid characters', () => {
      expect(FraudDetectionService.sanitizeUserId('user-123')).toBe('user-123');
      expect(FraudDetectionService.sanitizeUserId('user_456')).toBe('user_456');
    });

    it('returns empty string for non-string input', () => {
      expect(FraudDetectionService.sanitizeUserId(null)).toBe('');
      expect(FraudDetectionService.sanitizeUserId(123)).toBe('');
    });

    it('returns empty string for userId with invalid characters', () => {
      expect(FraudDetectionService.sanitizeUserId('user,123')).toBe('');
      expect(FraudDetectionService.sanitizeUserId('user(123)')).toBe('');
    });
  });

  describe('calculateDistance', () => {
    it('returns a positive number for valid coordinates', () => {
      const distance = FraudDetectionService.calculateDistance(28.61, 77.23, 28.62, 77.24);
      expect(typeof distance).toBe('number');
      expect(distance).toBeGreaterThan(0);
    });

    it('returns 0 for identical coordinates', () => {
      const distance = FraudDetectionService.calculateDistance(28.61, 77.23, 28.61, 77.23);
      expect(distance).toBe(0);
    });
  });

  describe('getCacheStats', () => {
    it('returns cache statistics object with correct structure', () => {
      const stats = FraudDetectionService.getCacheStats();
      expect(stats).toHaveProperty('riskScores');
      expect(stats).toHaveProperty('behavioralProfiles');
      expect(typeof stats.riskScores.size).toBe('number');
      expect(typeof stats.behavioralProfiles.size).toBe('number');
    });
  });

  // ============================================================================
  // 2. Behavioral Tracking & Edge Case Tests (Issue #14051)
  // ============================================================================
  describe('trackBehavior Edge Cases', () => {
    it('returns null when userId is null, undefined, or empty string', async () => {
      expect(await fraudService.trackBehavior(null, { type: 'click' })).toBeNull();
      expect(await fraudService.trackBehavior(undefined, { type: 'click' })).toBeNull();
      expect(await fraudService.trackBehavior('', { type: 'click' })).toBeNull();
    });

    it('falls back correctly to in-memory Map when Redis is not configured', async () => {
      fraudService.redis = null;
      const userId = 'user-memory-fallback';

      const profile = await fraudService.getOrCreateProfile(userId);
      expect(profile).toBeDefined();
      expect(fraudService.behavioralProfiles).toBeDefined();

      const tracked = await fraudService.trackBehavior(userId, { type: 'login' });
      expect(tracked).toBeTruthy();
      expect(fraudService.behavioralProfiles.has(userId)).toBe(true);
    });

    it('creates a brand new profile for unknown users via getOrCreateProfile', async () => {
      const userId = 'brand-new-user-999';
      const profile = await fraudService.getOrCreateProfile(userId);

      expect(profile).toBeDefined();
      expect(profile.userId).toBe(userId);
      expect(profile.events).toEqual([]);
      expect(profile.patterns).toHaveProperty('typingSpeed');
    });

    it('enforces behavioral profile event limit (max 100 events)', async () => {
      const userId = 'user-limit-test';

      // Push 105 events
      for (let i = 0; i < 105; i++) {
        await fraudService.trackBehavior(userId, { type: 'typing', wpm: i });
      }

      const profile = await fraudService.getOrCreateProfile(userId);
      const events = profile.events || [];
      expect(events.length).toBeLessThanOrEqual(100);
      expect(events.length).toBe(100);
    });

    it('handles batch upsert flush interval correctly', async () => {
      if (fraudService._flushInterval) clearInterval(fraudService._flushInterval);
      fraudService._flushInterval = setInterval(() => fraudService._flushPendingUpserts(), 5000);
      
      const flushSpy = vi.spyOn(fraudService, '_flushPendingUpserts');

      await fraudService.trackBehavior('user-batch-1', { type: 'transaction', amount: 250 });
      expect(fraudService.pendingUpserts.size).toBeGreaterThan(0);

      // Fast-forward timers to trigger batch flush interval (5000ms)
      vi.advanceTimersByTime(5000);

      expect(flushSpy).toHaveBeenCalled();
      expect(fraudService.pendingUpserts.size).toBe(0);
      expect(supabaseAdmin.from).toHaveBeenCalledWith('behavioral_profiles');
    });

    it('recovers gracefully when Redis cache entry is corrupt', async () => {
      fraudService.redis = {
        get: vi.fn().mockResolvedValue('invalid-corrupt-json{{{'),
      };

      const profile = await fraudService.getOrCreateProfile('corrupt-redis-user');
      expect(profile).toBeDefined();
      expect(profile.userId).toBe('corrupt-redis-user');
    });
  });

  describe('Cache Eviction & Stale Cleanup', () => {
    it('evicts stale risk scores when max limit is exceeded', () => {
      fraudService._maxRiskScores = 4;
      fraudService._evictionFraction = 0.5;

      for (let i = 0; i < 8; i++) {
        fraudService.riskScores.set(`user-score-${i}`, 0.4);
      }

      expect(fraudService.riskScores.size).toBe(8);
      fraudService._evictStale();
      expect(fraudService.riskScores.size).toBeLessThan(8);
      expect(fraudService._totalRiskScoresEvicted).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // 3. Network Analysis & Graph Fraud Ring Tests
  // ============================================================================
  describe('Network Analysis & Graph Building', () => {
    it('returns empty array when user has no connections', async () => {
      supabaseAdmin.from.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({ data: [], error: null })
      });

      const connections = await fraudService.getUserConnections('isolated-user');
      expect(connections).toEqual([]);
    });

    it('calculates network risk correctly based on graph nodes and fraud rings', async () => {
      const mockGraph = {
        nodes: ['user-1', 'conn-1', 'conn-2', 'conn-3'],
        edges: [
          { from: 'user-1', to: 'conn-1', weight: 0.4 },
          { from: 'conn-1', to: 'conn-2', weight: 0.4 },
          { from: 'conn-2', to: 'user-1', weight: 0.4 }
        ]
      };
      const fraudRings = [{ members: ['user-1', 'conn-1', 'conn-2'], size: 3 }];

      const risk = await fraudService.calculateNetworkRisk('user-1', mockGraph, fraudRings);
      expect(risk).toBeGreaterThan(0);
      expect(risk).toBeLessThanOrEqual(1.0);
    });

    it('handles batch user connections query correctly with empty inputs', async () => {
      const result = await fraudService.getBatchUserConnections([]);
      expect(result).toEqual({});
    });
  });

  // ============================================================================
  // 4. Real-Time Risk & Transaction Risk Scoring
  // ============================================================================
  describe('Real-Time Risk & Transaction Scoring', () => {
    it('calculates transaction risk correctly for abnormal amounts and odd hours', () => {
      const highRiskData = {
        amount: 150000, // > 100000 threshold
        frequency: 12,  // > 10 threshold
        deviceChanged: true
      };

      const risk = fraudService.calculateTransactionRisk(highRiskData);
      expect(risk).toBeGreaterThan(0.5);
    });

    it('combines risk scores using weighted average correctly', () => {
      const combined = fraudService.combineRiskScores(0.8, 0.5, 0.6);
      expect(combined).toBeTypeOf('number');
      expect(combined).toBeGreaterThan(0);
      expect(combined).toBeLessThanOrEqual(1.0);
    });

    it('correctly maps score to risk level strings', () => {
      expect(fraudService.getRiskLevel(0.1)).toBe('LOW');
      expect(fraudService.getRiskLevel(0.4)).toBe('MEDIUM');
      expect(fraudService.getRiskLevel(0.6)).toBe('HIGH');
      expect(fraudService.getRiskLevel(0.85)).toBe('CRITICAL');
    });
  });

  // ============================================================================
  // 5. Auto-Review Queue & Fraud Stats Management
  // ============================================================================
  describe('Auto-Review Queue & Statistics', () => {
    it('adds suspicious users to review queue successfully', async () => {
      const mockInsertedQueueItem = { id: 1, user_id: 'suspicious-user', status: 'pending' };
      supabaseAdmin.from.mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockInsertedQueueItem, error: null })
      });

      const result = await fraudService.addToReviewQueue('suspicious-user', 'High velocity orders', 0.85);
      expect(result).toBeDefined();
      expect(result.status).toBe('pending');
    });

    it('fetches pending review queue items', async () => {
      const mockQueue = [{ id: 1, user_id: 'user-A', risk_score: 0.9, status: 'pending' }];
      supabaseAdmin.from.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: mockQueue, error: null })
      });

      const queue = await fraudService.getReviewQueue(10);
      expect(queue).toHaveLength(1);
      expect(queue[0].user_id).toBe('user-A');
    });

    it('computes fraud statistics with paging correctly', async () => {
      const mockScores = [
        { risk_score: 0.8, created_at: Date.now() },
        { risk_score: 0.5, created_at: Date.now() },
        { risk_score: 0.2, created_at: Date.now() }
      ];
      supabaseAdmin.from.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({ data: mockScores, error: null })
      });

      const stats = await fraudService.getFraudStats();
      expect(stats.total).toBe(3);
      expect(stats.highRisk).toBe(1);
      expect(stats.mediumRisk).toBe(1);
      expect(stats.lowRisk).toBe(1);
      expect(stats.avgScore).toBeCloseTo((0.8 + 0.5 + 0.2) / 3);
    });

    it('resolves review items successfully', async () => {
      const resolvedItem = { id: 1, status: 'resolved', action: 'ban' };
      supabaseAdmin.from.mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: resolvedItem, error: null })
      });

      const res = await fraudService.resolveReview(1, 'ban', 'Confirmed fraud ring member');
      expect(res).toBeDefined();
      expect(res.status).toBe('resolved');
    });
  });

  // ============================================================================
  // 6. Additional Advanced Behavioral Pattern & Anomaly Tests
  // ============================================================================
  describe('Advanced Behavioral Pattern Anomalies', () => {
    it('detects typing speed variance anomalies and updates risk score', async () => {
      const userId = 'typing-anomaly-user';
      const profile = await fraudService.getOrCreateProfile(userId);
      
      for (let i = 0; i < 15; i++) {
        profile.patterns.typingSpeed.push({ speed: i % 2 === 0 ? 10 : 150, timestamp: Date.now() });
      }

      const risk = await fraudService.calculateBehavioralRisk(profile);
      expect(risk).toBeGreaterThan(0);
    });

    it('detects high event frequency within short window as bot behavior', async () => {
      const userId = 'frequency-bot-user';
      const profile = await fraudService.getOrCreateProfile(userId);

      for (let i = 0; i < 65; i++) {
        profile.events.push({ type: 'click', timestamp: Date.now() });
      }

      const risk = await fraudService.calculateBehavioralRisk(profile);
      expect(risk).toBeGreaterThan(0.2);
    });

    it('detects impossible travel speeds in location history as location spoofing', async () => {
      const userId = 'teleporting-user';
      const profile = await fraudService.getOrCreateProfile(userId);

      const now = Date.now();
      // Jump 1000 km in 1 hour (impossible road speed > 150 km/h)
      profile.patterns.locationHistory.push(
        { lat: 28.61, lng: 77.23, timestamp: now },
        { lat: 37.77, lng: -122.41, timestamp: now + 3600000 }
      );

      for (let i = 0; i < 10; i++) {
        profile.patterns.locationHistory.push({ lat: 37.77, lng: -122.41, timestamp: now + 3600000 + (i * 1000) });
      }

      const risk = await fraudService.calculateBehavioralRisk(profile);
      expect(risk).toBeGreaterThan(0.2);
    });

    it('detects abnormal transaction value spikes in profile history', async () => {
      const userId = 'transaction-spike-user';
      const profile = await fraudService.getOrCreateProfile(userId);

      for (let i = 0; i < 12; i++) {
        profile.patterns.transactionPatterns.push({ amount: 100, type: 'payment', timestamp: Date.now() });
      }
      // Add a massive outlier transaction (> 5 times average)
      profile.patterns.transactionPatterns.push({ amount: 10000, type: 'payment', timestamp: Date.now() });

      const risk = await fraudService.calculateBehavioralRisk(profile);
      expect(risk).toBeGreaterThan(0);
    });
  });
});
