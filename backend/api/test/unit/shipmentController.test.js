import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: { supabase: { from: vi.fn() } },
}));

vi.mock('../../src/config/db.js', () => ({
  get supabase() { return dbMock.supabase; },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { getShipmentDetails } from '../../src/controllers/shipmentController.js';

function makeReqRes(overrides = {}) {
  const req = {
    query: {},
    params: {},
    user: { id: 'u1' },
    ...overrides,
  };
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return { req, res };
}

describe('shipmentController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getShipmentDetails', () => {
    it('returns 400 when shipmentId is missing', async () => {
      const { req, res } = makeReqRes();
      await getShipmentDetails(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'shipmentId is required' });
    });

    it('returns 404 when the shipment is not found', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: null, error: null }) })) })),
      });
      const { req, res } = makeReqRes({ query: { shipmentId: 's1' } });
      await getShipmentDetails(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Shipment not found' });
    });

    it('returns 403 when the user is neither owner nor driver', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: 's1', customer_id: 'other', driver_id: 'other2' }, error: null }) })) })),
      });
      const { req, res } = makeReqRes({ query: { shipmentId: 's1' } });
      await getShipmentDetails(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns the shipment for the owner', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: 's1', customer_id: 'u1', driver_id: null }, error: null }) })) })),
      });
      const { req, res } = makeReqRes({ query: { shipmentId: 's1' } });
      await getShipmentDetails(req, res);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 's1', customer_id: 'u1', driver_id: null } });
    });

    it('returns 500 on unexpected error', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockRejectedValue(new Error('boom')) })) })),
      });
      const { req, res } = makeReqRes({ query: { shipmentId: 's1' } });
      await getShipmentDetails(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
