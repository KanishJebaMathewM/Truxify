import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock } from '../helpers/supabaseMock.js';

const { supabaseMock, reset } = (() => {
  const mock = createSupabaseMock();
  return { supabaseMock: mock, reset: mock.reset.bind(mock) };
})();

vi.mock('../../src/config/db.js', () => ({
  
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
  get supabase() { return supabaseMock.supabase; },
  get supabaseAdmin() { return supabaseMock.supabase; },
  createUserClient: () => supabaseMock.supabase,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'user-123' };
    next();
  },
}));

import { getShipmentDetails } from '../../src/controllers/shipmentController.js';

function makeMockReq(overrides = {}) {
  return {
    user: { id: 'user-123' },
    token: 'test-token',
    query: {},
    params: {},
    ...overrides,
  };
}

function makeMockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('shipmentController', () => {
  beforeEach(() => {
    reset();
    vi.clearAllMocks();
  });

  describe('getShipmentDetails', () => {
    it('returns 400 when shipmentId is missing from query and params', async () => {
      const req = makeMockReq({ query: {}, params: {} });
      const res = makeMockRes();
      const next = vi.fn();

      await getShipmentDetails(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'shipmentId is required' });
    });

    it('returns 400 when shipmentId is null', async () => {
      const req = makeMockReq({ query: { shipmentId: null }, params: {} });
      const res = makeMockRes();
      const next = vi.fn();

      await getShipmentDetails(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when the shipment is not found', async () => {
      supabaseMock.store.orders = [];
      supabaseMock.programError('not found');

      const req = makeMockReq({ query: { shipmentId: 'shipment-999' }, params: {} });
      const res = makeMockRes();
      const next = vi.fn();

      await getShipmentDetails(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Shipment not found' });
    });

    it('returns 403 when user is neither the owner nor the assigned driver', async () => {
      supabaseMock.store.orders = [{
        id: 'shipment-1',
        customer_id: 'other-user',
        driver_id: 'another-user',
      }];

      const req = makeMockReq({ query: { shipmentId: 'shipment-1' }, params: {}, user: { id: 'user-123' } });
      const res = makeMockRes();
      const next = vi.fn();

      await getShipmentDetails(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('Forbidden') })
      );
    });

    it('returns the shipment when the user is the owner', async () => {
      supabaseMock.store.orders = [{
        id: 'shipment-1',
        customer_id: 'user-123',
        driver_id: 'other-driver',
        status: 'in_transit',
      }];

      const req = makeMockReq({ query: { shipmentId: 'shipment-1' }, params: {}, user: { id: 'user-123' } });
      const res = makeMockRes();
      const next = vi.fn();

      await getShipmentDetails(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ id: 'shipment-1' }),
        })
      );
    });

    it('returns the shipment when the user is the assigned driver', async () => {
      supabaseMock.store.orders = [{
        id: 'shipment-1',
        customer_id: 'owner-user',
        driver_id: 'user-123',
        status: 'picked_up',
      }];

      const req = makeMockReq({ query: { shipmentId: 'shipment-1' }, params: {}, user: { id: 'user-123' } });
      const res = makeMockRes();
      const next = vi.fn();

      await getShipmentDetails(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ id: 'shipment-1' }),
        })
      );
    });
  });
});
