import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fraudMock } = vi.hoisted(() => ({
  fraudMock: {
    trackBehavior: vi.fn(),
    getRealTimeRisk: vi.fn(),
    addToReviewQueue: vi.fn(),
    analyzeNetwork: vi.fn(),
  },
}));

vi.mock('../../src/services/fraud/FraudDetectionService.js', () => ({ default: fraudMock }));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { fraudDetectionMiddleware, networkAnalysisMiddleware } from '../../src/middleware/fraudMiddleware.js';

function makeReqRes(overrides = {}) {
  const req = {
    user: { id: 'u1' },
    method: 'GET',
    originalUrl: '/api/orders/1',
    path: '/orders/1',
    ip: '1.2.3.4',
    headers: {},
    body: {},
    ...overrides,
  };
  const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
  const next = vi.fn();
  return { req, res, next };
}

describe('fraudMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fraudMock.trackBehavior.mockResolvedValue({});
    fraudMock.getRealTimeRisk.mockResolvedValue({ riskScore: 0.1, riskLevel: 'LOW' });
    fraudMock.addToReviewQueue.mockResolvedValue({});
  });

  describe('fraudDetectionMiddleware', () => {
    it('passes through when there is no user', async () => {
      const { req, res, next } = makeReqRes({ user: null });
      await fraudDetectionMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('tracks behavior and calls next on non-critical endpoints', async () => {
      const { req, res, next } = makeReqRes({ originalUrl: '/api/profile' });
      await fraudDetectionMiddleware(req, res, next);
      expect(fraudMock.trackBehavior).toHaveBeenCalledWith('u1', expect.objectContaining({ type: 'GET' }));
      expect(next).toHaveBeenCalled();
    });

    it('blocks high-risk requests on critical endpoints', async () => {
      fraudMock.getRealTimeRisk.mockResolvedValue({ riskScore: 0.95, riskLevel: 'HIGH' });
      const { req, res, next } = makeReqRes({ originalUrl: '/api/orders' });
      await fraudDetectionMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('fails closed with 503 on service errors', async () => {
      fraudMock.trackBehavior.mockRejectedValue(new Error('down'));
      const { req, res, next } = makeReqRes({ originalUrl: '/api/orders' });
      await fraudDetectionMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(503);
    });

    // #10501: trips are mounted at /api/v1/trips in index.js, so the fraud
    // middleware's criticalEndpoints entry must match that path (not the
    // auth-less /api/trips mount). A v1 trip request must be treated as
    // critical and run real-time risk scoring.
    it('treats /api/v1/trips requests as critical (runs risk scoring)', async () => {
      const { req, res, next } = makeReqRes({ originalUrl: '/api/v1/trips/123' });
      await fraudDetectionMiddleware(req, res, next);
      expect(fraudMock.getRealTimeRisk).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('blocks high-risk /api/v1/trips requests', async () => {
      fraudMock.getRealTimeRisk.mockResolvedValue({ riskScore: 0.95, riskLevel: 'HIGH' });
      const { req, res, next } = makeReqRes({ originalUrl: '/api/v1/trips' });
      await fraudDetectionMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('includes the request id in the review queue reason', async () => {
      fraudMock.getRealTimeRisk.mockResolvedValue({ riskScore: 0.8, riskLevel: 'HIGH' });
      const { req, res, next } = makeReqRes({ requestId: 'fraud-req-42' });
      await fraudDetectionMiddleware(req, res, next);
      expect(fraudMock.addToReviewQueue).toHaveBeenCalledWith(
        'u1',
        expect.stringContaining('fraud-req-42'),
        0.8
      );
      expect(next).toHaveBeenCalled();
    });
  });

  describe('networkAnalysisMiddleware', () => {
    it('passes through without a user', async () => {
      const { req, res, next } = makeReqRes({ user: null });
      await networkAnalysisMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('queues users in a fraud ring', async () => {
      fraudMock.analyzeNetwork.mockResolvedValue({ isInFraudRing: true, networkRisk: 0.8 });
      const { req, res, next } = makeReqRes();
      await networkAnalysisMiddleware(req, res, next);
      expect(fraudMock.addToReviewQueue).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('fails closed with 503 on error', async () => {
      fraudMock.analyzeNetwork.mockRejectedValue(new Error('down'));
      const { req, res, next } = makeReqRes();
      await networkAnalysisMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(503);
    });
  });
});
