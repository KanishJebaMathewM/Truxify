import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'driver-1', role: 'driver' };
    next();
  },
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: () => (req, _res, next) => next(),
}));

vi.mock('../../src/services/ml.js', () => ({
  matchDeadhead: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const serviceMock = vi.hoisted(() => ({
  findMidTripLoadOpportunities: vi.fn(),
  insertMidTripLoad: vi.fn(),
}));

vi.mock('../../src/services/order/deadheadMatchingService.js', () => ({
  default: serviceMock,
}));

const { default: deadheadRouter } = await import('../../src/routes/deadheadRoutes.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/deadhead', deadheadRouter);
  return app;
}

describe('POST /deadhead/match/insert-mid-trip-waypoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the authenticated driver into the insertion service', async () => {
    serviceMock.insertMidTripLoad.mockResolvedValue({
      success: true,
      orderId: 'ORDER-1',
      loadOfferId: 'OFFER-1',
    });

    const res = await request(makeApp())
      .post('/deadhead/match/insert-mid-trip-waypoint')
      .send({ order_id: 'ORDER-1', load_offer_id: 'OFFER-1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(serviceMock.insertMidTripLoad).toHaveBeenCalledWith({
      orderId: 'ORDER-1',
      loadOfferId: 'OFFER-1',
      driverId: 'driver-1',
    });
  });

  it('maps authorization and conflict errors from the service', async () => {
    serviceMock.insertMidTripLoad.mockRejectedValue(
      Object.assign(new Error('Access Denied: Order is not assigned to this driver'), { status: 403 })
    );

    const forbidden = await request(makeApp())
      .post('/deadhead/match/insert-mid-trip-waypoint')
      .send({ order_id: 'ORDER-1', load_offer_id: 'OFFER-1' });

    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toMatch(/not assigned/i);

    serviceMock.insertMidTripLoad.mockRejectedValue(
      Object.assign(new Error('Load offer is no longer available for insertion'), { status: 409 })
    );

    const conflict = await request(makeApp())
      .post('/deadhead/match/insert-mid-trip-waypoint')
      .send({ order_id: 'ORDER-1', load_offer_id: 'OFFER-1' });

    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toMatch(/no longer available/i);
  });

  it('rejects missing identifiers before calling the service', async () => {
    const res = await request(makeApp())
      .post('/deadhead/match/insert-mid-trip-waypoint')
      .send({ order_id: 'ORDER-1' });

    expect(res.status).toBe(400);
    expect(serviceMock.insertMidTripLoad).not.toHaveBeenCalled();
  });
});
