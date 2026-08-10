import { describe, it, expect, vi, beforeEach } from 'vitest';

const { from, createUserClientMock } = vi.hoisted(() => ({
  from: vi.fn(),
  createUserClientMock: vi.fn(),
}));

vi.mock('../../../src/config/db.js', () => ({
  supabase: { from },
  createUserClient: createUserClientMock,
}));

import { getShipmentDetails } from '../../../src/controllers/shipmentController.js';

const buildClient = (data, error) => ({
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(async () => ({ data, error })),
      })),
    })),
  })),
});

describe('shipmentController.getShipmentDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the shipment through the caller\'s JWT client (RLS-scoped), not the anon client', async () => {
    const client = buildClient({ id: 'ship_1', customer_id: 'user_1', driver_id: null }, null);
    createUserClientMock.mockReturnValue(client);

    const req = {
      query: {},
      token: 'user-jwt',
      params: { shipmentId: 'ship_1' },
      user: { id: 'user_1' },
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await getShipmentDetails(req, res);

    expect(createUserClientMock).toHaveBeenCalledWith('user-jwt');
    expect(client.from).toHaveBeenCalledWith('orders');
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: expect.objectContaining({ id: 'ship_1' }) });
  });

  it('allows the assigned driver to view the shipment', async () => {
    const client = buildClient({ id: 'ship_1', customer_id: 'user_1', driver_id: 'driver_1' }, null);
    createUserClientMock.mockReturnValue(client);

    const req = {
      query: {},
      token: 'driver-jwt',
      params: { shipmentId: 'ship_1' },
      user: { id: 'driver_1' },
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await getShipmentDetails(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: expect.objectContaining({ id: 'ship_1' }) });
  });

  it('returns 404 when the shipment is not found', async () => {
    createUserClientMock.mockReturnValue(buildClient(null, { message: 'not found' }));

    const req = {
      query: {},
      token: 'user-jwt',
      params: { shipmentId: 'missing' },
      user: { id: 'user_1' },
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await getShipmentDetails(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Shipment not found' });
  });

  it('returns 403 when the user is neither owner nor assigned driver', async () => {
    createUserClientMock.mockReturnValue(buildClient({ id: 'ship_1', customer_id: 'user_1', driver_id: 'driver_1' }, null));

    const req = {
      query: {},
      token: 'stranger-jwt',
      params: { shipmentId: 'ship_1' },
      user: { id: 'stranger' },
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await getShipmentDetails(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 400 when shipmentId is missing', async () => {
    const req = { query: {}, token: 'user-jwt', params: {}, user: { id: 'user_1' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await getShipmentDetails(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(createUserClientMock).not.toHaveBeenCalled();
  });
});
