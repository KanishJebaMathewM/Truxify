import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbState = vi.hoisted(() => ({
  rpcImpl: null,
}));

function makeChain() {
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    not: vi.fn(() => q),
    in: vi.fn(() => q),
    rpc: vi.fn(async (...args) => dbState.rpcImpl(...args)),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
  };
  return q;
}

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: {
    from: vi.fn(() => makeChain()),
    rpc: vi.fn(async (...args) => dbState.rpcImpl(...args)),
  },
  supabase: null,
  redisClient: null,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/core/performanceMetrics.js', () => ({
  measureExecution: (_name, fn) => fn(),
}));

vi.mock('../../src/services/osrm.js', () => ({
  getRouteEstimate: vi.fn(async () => ({ distanceKm: 1000 })),
  validateCoordinates: vi.fn(() => null),
}));

vi.mock('../../src/lib/pricing.js', () => ({
  computeOrderPricing: vi.fn(() => ({
    baseFreight: 20000,
    tollEstimate: 2000,
    platformFee: 1100,
    totalAmount: 23100,
    distanceKm: 1000,
    fuelCost: 8000,
    netProfit: 10900,
  })),
}));

vi.mock('../../src/services/trafficService.js', () => ({
  getLiveTrafficMultiplier: vi.fn(async () => 1.0),
}));

vi.mock('../../src/services/ml.js', () => ({
  predictPrice: vi.fn(async () => null),
}));

vi.mock('../../src/services/notificationService.js', () => ({
  sendFcmNotification: vi.fn(async () => ({ success: true })),
}));

import { createOrder } from '../../src/services/order/orderCreationService.js';
import { supabaseAdmin } from '../../src/config/db.js';

const orderData = {
  pickup_address: 'Delhi', pickup_lat: 28.6139, pickup_lng: 77.2090,
  drop_address: 'Mumbai', drop_lat: 19.0760, drop_lng: 72.8777,
  goods_type: 'Electronics', weight_tonnes: 5, customer_id: 'cust-1',
};

function createdRow(overrides = {}) {
  return {
    id: 'order-new',
    order_display_id: '#FF20260808ABC123XYZ456',
    status: 'pending',
    ...overrides,
  };
}

describe('orderCreationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.rpcImpl = async (fnName) => {
      if (fnName === 'get_nearby_active_drivers') {
        return { data: [], error: null };
      }
      return { data: createdRow(), error: null };
    };
  });

  describe('createOrder', () => {
    it('creates an order with valid data', async () => {
      const result = await createOrder({ orderData, userId: 'cust-1' });

      expect(result.message).toContain('Order created successfully');
      expect(result.order.id).toBe('order-new');
      expect(result.order.status).toBe('pending');
      expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
        'create_order_tx',
        expect.objectContaining({ p_customer_id: 'cust-1' })
      );
    });

    it('rejects requests missing routing or cargo fields', async () => {
      await expect(
        createOrder({ orderData: { pickup_address: '', customer_id: 'cust-1' }, userId: 'cust-1' })
      ).rejects.toThrow('Missing required routing or cargo specification fields');
      expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
    });

    it('generates a display id for the new order', async () => {
      await createOrder({ orderData, userId: 'cust-1' });

      const [, args] = supabaseAdmin.rpc.mock.calls.find(([fn]) => fn === 'create_order_tx');
      expect(args.p_order_display_id).toMatch(/^#FF\d{8}/);
    });
  });
});
