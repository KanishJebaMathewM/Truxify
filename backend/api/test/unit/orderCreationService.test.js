import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn() },
  supabaseAdmin: { rpc: vi.fn(), from: vi.fn() },
}));

vi.mock('../../src/services/osrm.js', () => ({
  getRouteEstimate: vi.fn(),
  validateCoordinates: vi.fn(),
}));

vi.mock('../../src/services/trafficService.js', () => ({
  getLiveTrafficMultiplier: vi.fn(),
}));

vi.mock('../../src/services/ml.js', () => ({
  predictPrice: vi.fn(),
}));

import { supabaseAdmin } from '../../src/config/db.js';
import { getRouteEstimate, validateCoordinates } from '../../src/services/osrm.js';
import { getLiveTrafficMultiplier } from '../../src/services/trafficService.js';
import { predictPrice } from '../../src/services/ml.js';

const validOrderData = {
  pickup_address: 'Delhi',
  pickup_lat: 28.6139,
  pickup_lng: 77.209,
  drop_address: 'Mumbai',
  drop_lat: 19.076,
  drop_lng: 72.8777,
  goods_type: 'Electronics',
  weight_tonnes: 5,
};

describe('orderCreationService', () => {
  let orderCreationService;

  beforeEach(async () => {
    vi.resetAllMocks();
    validateCoordinates.mockReturnValue(null);
    getLiveTrafficMultiplier.mockResolvedValue(1.0);
    predictPrice.mockResolvedValue({ estimatedPricePaisa: 1500000 });
    orderCreationService = await import('../../src/services/order/orderCreationService.js');
  });

  describe('createOrder', () => {
    it('creates an order and broadcasts it to the loads board', async () => {
      getRouteEstimate.mockResolvedValue({ distanceKm: 120 });
      supabaseAdmin.rpc.mockImplementation((fn) =>
        fn === 'create_order_tx'
          ? { data: { id: 'order-1', order_display_id: 'OD-1' }, error: null }
          : { data: [], error: null },
      );

      const result = await orderCreationService.createOrder({
        orderData: validOrderData,
        userId: 'user-1',
        user: { fullName: 'Alice' },
      });

      expect(result.order.id).toBe('order-1');
      expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
        'create_order_tx',
        expect.objectContaining({ p_customer_id: 'user-1', p_customer_name: 'Alice' }),
      );
    });

    it('throws when required routing or cargo fields are missing', async () => {
      await expect(
        orderCreationService.createOrder({
          orderData: { drop_address: 'Mumbai' },
          userId: 'user-1',
          user: { fullName: 'Alice' },
        }),
      ).rejects.toThrow('Missing required routing or cargo specification fields.');
    });

    it('throws when the coordinates are invalid', async () => {
      validateCoordinates.mockReturnValueOnce('Latitude must be between -90 and 90.');

      await expect(
        orderCreationService.createOrder({
          orderData: validOrderData,
          userId: 'user-1',
          user: { fullName: 'Alice' },
        }),
      ).rejects.toThrow('Latitude must be between -90 and 90.');
    });

    it('throws when pricing computation fails', async () => {
      getRouteEstimate.mockRejectedValue(new Error('OSRM timeout'));

      await expect(
        orderCreationService.createOrder({
          orderData: validOrderData,
          userId: 'user-1',
          user: { fullName: 'Alice' },
        }),
      ).rejects.toThrow('Unable to compute freight pricing for the given route/cargo.');
    });

    it('retries order creation when the display id collides', async () => {
      let createAttempts = 0;
      supabaseAdmin.rpc.mockImplementation((fn) => {
        if (fn === 'create_order_tx') {
          createAttempts += 1;
          if (createAttempts === 1) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          }
          return { data: { id: 'order-1', order_display_id: 'OD-1' }, error: null };
        }
        return { data: [], error: null };
      });

      const result = await orderCreationService.createOrder({
        orderData: validOrderData,
        userId: 'user-1',
        user: { fullName: 'Alice' },
      });

      const createOrderCalls = supabaseAdmin.rpc.mock.calls.filter(([fn]) => fn === 'create_order_tx');
      expect(createOrderCalls).toHaveLength(2);
      expect(result.order.id).toBe('order-1');
    });
  });

  describe('findTargetDrivers', () => {
    it('returns only drivers whose truck capacity can carry the load', async () => {
      supabaseAdmin.rpc.mockResolvedValue({
        data: [{ driver_id: 'd1' }, { driver_id: 'd2' }, { driver_id: 'd3' }],
        error: null,
      });
      const driverDetailsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        data: [
          { user_id: 'd1', truck_id: 't1' },
          { user_id: 'd2', truck_id: 't2' },
          { user_id: 'd3', truck_id: 't3' },
        ],
      };
      const trucksChain = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        data: [
          { id: 't1', max_capacity_tons: 10 },
          { id: 't2', max_capacity_tons: 4 },
          { id: 't3', max_capacity_tons: null },
        ],
      };
      supabaseAdmin.from.mockImplementation((table) => (table === 'driver_details' ? driverDetailsChain : trucksChain));

      const result = await orderCreationService.findTargetDrivers({ pickupLat: 28.6, pickupLng: 77.2, weightTonnes: 5 });
      expect(result).toEqual(['d1']);
    });

    it('returns an empty array when the nearby-driver RPC fails', async () => {
      supabaseAdmin.rpc.mockResolvedValue({ data: null, error: { message: 'rpc down' } });

      const result = await orderCreationService.findTargetDrivers({ pickupLat: 28.6, pickupLng: 77.2, weightTonnes: 5 });
      expect(result).toEqual([]);
    });
  });
});
