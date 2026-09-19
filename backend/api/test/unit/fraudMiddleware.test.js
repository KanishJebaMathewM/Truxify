import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the middleware
vi.mock('../../src/services/fraud/FraudDetectionService.js', () => ({
  default: {
    trackBehavior: vi.fn().mockResolvedValue(true),
    getRealTimeRisk: vi.fn().mockResolvedValue({ riskScore: 0.2, riskLevel: 'LOW' }),
    addToReviewQueue: vi.fn().mockResolvedValue({ id: 1 }),
    analyzeNetwork: vi.fn().mockResolvedValue({ networkRisk: 0.1, isInFraudRing: false })
  }
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

import { fraudDetectionMiddleware, networkAnalysisMiddleware, clampRiskScore, accumulateRisk } from '../../src/middleware/fraudMiddleware.js';
import fraudDetection from '../../src/services/fraud/FraudDetectionService.js';
import logger from '../../src/middleware/logger.js';

describe('Fraud Middleware & Security Pipeline Test Suite (#14043)', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      user: { id: 'user-123' },
      originalUrl: '/api/orders',
      path: '/api/orders',
      method: 'POST',
      ip: '127.0.0.1',
      headers: { 'user-agent': 'Mozilla/5.0' },
      body: { amount: 500 }
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    };
    next = vi.fn();
  });

  // ============================================================================
  // 1. fraudDetectionMiddleware Tests
  // ============================================================================
  describe('fraudDetectionMiddleware', () => {
    it('skips fraud checks and calls next() when userId is missing (public/unauthenticated)', async () => {
      req.user = null;
      await fraudDetectionMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(fraudDetection.trackBehavior).not.toHaveBeenCalled();
    });

    it('tracks behavior and passes clean requests on critical endpoints without blocking', async () => {
      fraudDetection.getRealTimeRisk.mockResolvedValueOnce({ riskScore: 0.3, riskLevel: 'LOW' });

      await fraudDetectionMiddleware(req, res, next);

      expect(fraudDetection.trackBehavior).toHaveBeenCalledWith('user-123', expect.any(Object));
      expect(fraudDetection.getRealTimeRisk).toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.riskScore).toBe(0.3);
      expect(req.riskLevel).toBe('LOW');
    });

    it('flags request for review when risk score exceeds review threshold (> 0.7)', async () => {
      fraudDetection.getRealTimeRisk.mockResolvedValueOnce({ riskScore: 0.8, riskLevel: 'HIGH' });

      await fraudDetectionMiddleware(req, res, next);

      expect(fraudDetection.addToReviewQueue).toHaveBeenCalledWith(
        'user-123',
        expect.stringContaining('Suspicious activity'),
        0.8
      );
      expect(next).toHaveBeenCalledTimes(1); // Still passes through if <= block threshold
    });

    it('blocks high-risk transactions with 403 status when risk score exceeds block threshold (> 0.9)', async () => {
      fraudDetection.getRealTimeRisk.mockResolvedValueOnce({ riskScore: 0.95, riskLevel: 'CRITICAL' });

      await fraudDetectionMiddleware(req, res, next);

      expect(fraudDetection.addToReviewQueue).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Transaction blocked due to suspicious activity',
        riskScore: 0.95,
        riskLevel: 'CRITICAL'
      }));
      expect(next).not.toHaveBeenCalled();
    });

    it('skips real-time risk evaluation for non-critical endpoints while still tracking behavior', async () => {
      req.originalUrl = '/api/public/status';
      req.path = '/api/public/status';

      await fraudDetectionMiddleware(req, res, next);

      expect(fraudDetection.trackBehavior).toHaveBeenCalled();
      expect(fraudDetection.getRealTimeRisk).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('fails closed with 503 status when fraud detection service throws an unexpected error', async () => {
      fraudDetection.trackBehavior.mockRejectedValueOnce(new Error('Redis connection drop'));

      await fraudDetectionMiddleware(req, res, next);

      expect(logger.error).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Fraud detection service is temporarily unavailable. Please retry.'
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // 2. networkAnalysisMiddleware Tests
  // ============================================================================
  describe('networkAnalysisMiddleware', () => {
    it('skips network analysis and calls next() when userId is missing', async () => {
      req.user = null;
      await networkAnalysisMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(fraudDetection.analyzeNetwork).not.toHaveBeenCalled();
    });

    it('adds user to review queue when network analysis flags them in a fraud ring', async () => {
      fraudDetection.analyzeNetwork.mockResolvedValueOnce({ networkRisk: 0.85, isInFraudRing: true });

      await networkAnalysisMiddleware(req, res, next);

      expect(fraudDetection.addToReviewQueue).toHaveBeenCalledWith(
        'user-123',
        'Part of suspected fraud ring',
        0.85
      );
      expect(req.networkRisk).toEqual({ networkRisk: 0.85, isInFraudRing: true });
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('fails closed with 503 status when network analysis throws an error', async () => {
      fraudDetection.analyzeNetwork.mockRejectedValueOnce(new Error('Graph DB timeout'));

      await networkAnalysisMiddleware(req, res, next);

      expect(logger.error).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Fraud detection service is temporarily unavailable. Please retry.'
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // 3. Helper Functions Tests (clampRiskScore & accumulateRisk)
  // ============================================================================
  describe('Risk Scoring Utility Helpers', () => {
    it('clamps risk scores correctly within [0, 100] bounds', () => {
      expect(clampRiskScore(-10)).toBe(0);
      expect(clampRiskScore(50)).toBe(50);
      expect(clampRiskScore(150)).toBe(100);
      expect(clampRiskScore(NaN)).toBe(0);
      expect(clampRiskScore(Infinity)).toBe(0); // Wait, Number.isFinite(Infinity) is false -> returns 0 based on implementation
    });

    it('accumulates array of risk weights correctly with validation', () => {
      expect(accumulateRisk([10, 20, 30])).toBe(60);
      expect(accumulateRisk([80, 40])).toBe(100); // Clamped at 100
      expect(accumulateRisk([-50, 20])).toBe(0);  // Clamped at 0
      expect(accumulateRisk('not-an-array')).toBe(0);
      expect(accumulateRisk([10, NaN, 20])).toBe(30); // Filters out NaN gracefully
    });
  });

  // ============================================================================
  // 4. Advanced Enterprise Security Pipeline & Endpoint Add-On Tests
  // ============================================================================
  describe('Advanced Enterprise Security Pipeline Additions', () => {
    it('evaluates critical endpoint /api/payments correctly and triggers review on high risk', async () => {
      req.originalUrl = '/api/payments';
      req.path = '/api/payments';
      req.body = { amount: 50000 };
      fraudDetection.getRealTimeRisk.mockResolvedValueOnce({ riskScore: 0.75, riskLevel: 'HIGH' });

      await fraudDetectionMiddleware(req, res, next);

      expect(fraudDetection.addToReviewQueue).toHaveBeenCalledWith(
        'user-123',
        'Suspicious activity on /api/payments',
        0.75
      );
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('blocks critical endpoint /api/escrow when risk score exceeds 0.9', async () => {
      req.originalUrl = '/api/escrow/release';
      req.path = '/api/escrow/release';
      fraudDetection.getRealTimeRisk.mockResolvedValueOnce({ riskScore: 0.92, riskLevel: 'CRITICAL' });

      await fraudDetectionMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Transaction blocked due to suspicious activity',
        riskScore: 0.92
      }));
      expect(next).not.toHaveBeenCalled();
    });

    it('evaluates critical endpoint /api/trips safely with deviceChanged flag', async () => {
      req.originalUrl = '/api/trips/start';
      req.path = '/api/trips/start';
      req.deviceChanged = true;
      fraudDetection.getRealTimeRisk.mockResolvedValueOnce({ riskScore: 0.2, riskLevel: 'LOW' });

      await fraudDetectionMiddleware(req, res, next);

      expect(fraudDetection.getRealTimeRisk).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({ deviceChanged: true })
      );
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('handles requests with missing or empty request body gracefully', async () => {
      req.body = null;
      fraudDetection.getRealTimeRisk.mockResolvedValueOnce({ riskScore: 0.1, riskLevel: 'LOW' });

      await fraudDetectionMiddleware(req, res, next);

      expect(fraudDetection.getRealTimeRisk).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({ amount: 0 })
      );
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('logs warning in network analysis when userId is missing', async () => {
      req.user = null;
      await networkAnalysisMiddleware(req, res, next);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Skipping network analysis')
      );
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('handles multiple risk weight accumulations with floating point values accurately', () => {
      const result = accumulateRisk([15.5, 25.2, 9.3]);
      expect(result).toBeCloseTo(50, 1);
    });

    it('handles extreme negative numbers and boundary values in clampRiskScore', () => {
      expect(clampRiskScore(-9999)).toBe(0);
      expect(clampRiskScore(0)).toBe(0);
      expect(clampRiskScore(100)).toBe(100);
      expect(clampRiskScore(100.01)).toBe(100);
    });

    it('handles non-array inputs in accumulateRisk gracefully by returning 0', () => {
      expect(accumulateRisk(null)).toBe(0);
      expect(accumulateRisk(undefined)).toBe(0);
      expect(accumulateRisk({ score: 50 })).toBe(0);
    });
  });
});