import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/config/db.js', () => ({
  redisClient: null,
  supabaseAdmin: null,
}));

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const fraudDetectionService = (await import('../../../../src/services/fraud/FraudDetectionService.js')).default;

describe('FraudDetectionService', () => {
  beforeEach(() => {
    // Reset singleton internal state between tests
    fraudDetectionService.behavioralProfiles.clear();
    fraudDetectionService.riskScores.clear();
    fraudDetectionService.pendingUpserts.clear();
  });

  describe('singleton initialization', () => {
    it('defaults fraudThreshold to 0.7 when FRAUD_THRESHOLD env var is not set', () => {
      expect(fraudDetectionService.fraudThreshold).toBe(0.7);
    });

    it('fraudThreshold is a finite number', () => {
      expect(Number.isFinite(fraudDetectionService.fraudThreshold)).toBe(true);
    });

    it('has behavioralProfiles as Map', () => {
      expect(fraudDetectionService.behavioralProfiles).toBeInstanceOf(Map);
    });

    it('has riskScores as Map', () => {
      expect(fraudDetectionService.riskScores).toBeInstanceOf(Map);
    });

    it('sets max cache sizes', () => {
      expect(fraudDetectionService._maxRiskScores).toBe(10000);
      expect(fraudDetectionService._maxBehavioralProfiles).toBe(5000);
    });
  });

  describe('getRiskLevel', () => {
    it('returns LOW for score < 0.3', () => {
      expect(fraudDetectionService.getRiskLevel(0.1)).toBe('LOW');
      expect(fraudDetectionService.getRiskLevel(0.29)).toBe('LOW');
    });

    it('returns MEDIUM for score between 0.3 and 0.5', () => {
      expect(fraudDetectionService.getRiskLevel(0.3)).toBe('MEDIUM');
      expect(fraudDetectionService.getRiskLevel(0.49)).toBe('MEDIUM');
    });

    it('returns HIGH for score between 0.5 and 0.7', () => {
      expect(fraudDetectionService.getRiskLevel(0.5)).toBe('HIGH');
      expect(fraudDetectionService.getRiskLevel(0.69)).toBe('HIGH');
    });

    it('returns CRITICAL for score >= 0.7', () => {
      expect(fraudDetectionService.getRiskLevel(0.7)).toBe('CRITICAL');
      expect(fraudDetectionService.getRiskLevel(1.0)).toBe('CRITICAL');
    });
  });

  describe('trackBehavior', () => {
    it('returns null when userId is falsy', async () => {
      const result = await fraudDetectionService.trackBehavior(null, { type: 'login' });
      expect(result).toBeNull();
    });

    it('returns null when supabaseAdmin is not configured', async () => {
      fraudDetectionService.supabaseAdmin = null;
      const result = await fraudDetectionService.trackBehavior('user-123', { type: 'login' });
      expect(result).toBeNull();
    });
  });

  describe('_evictStale', () => {
    it('does not throw when evicting stale entries', () => {
      fraudDetectionService.riskScores.set('stale-risk', 0.5);
      expect(() => fraudDetectionService._evictStale()).not.toThrow();
    });
  });

  describe('_flushPendingUpserts', () => {
    it('does not throw when pendingUpserts is empty', () => {
      fraudDetectionService.pendingUpserts.clear();
      expect(() => fraudDetectionService._flushPendingUpserts()).not.toThrow();
    });

    it('does not throw when supabaseAdmin is not configured', () => {
      fraudDetectionService.pendingUpserts.set('user-1', { some: 'data' });
      fraudDetectionService.supabaseAdmin = null;
      expect(() => fraudDetectionService._flushPendingUpserts()).not.toThrow();
    });
  });
});
