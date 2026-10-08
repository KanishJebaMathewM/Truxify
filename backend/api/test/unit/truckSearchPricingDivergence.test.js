import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc, mockSupabase, mockPredictPrice } = vi.hoisted(() => {
  const mockRpc = vi.fn();
  const mockSupabase = {
    rpc: mockRpc,
    from: vi.fn(),
  };
  const mockPredictPrice = vi.fn();
  return { mockRpc, mockSupabase, mockPredictPrice };
});

vi.mock('../../src/config/db.js', () => ({
  supabase: mockSupabase,
  supabaseAdmin: mockSupabase,
  mongoDb: null,
  redisClient: null,
}));

vi.mock('../../src/services/osrm.js', () => ({
  getRouteEstimate: vi.fn().mockResolvedValue({ distanceKm: 100 }),
  validateCoordinates: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/services/trafficService.js', () => ({
  getLiveTrafficMultiplier: vi.fn().mockResolvedValue(1.2),
}));

vi.mock('../../src/services/ml.js', () => ({
  predictPrice: mockPredictPrice,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/core/performanceMetrics.js', () => ({
  measureExecution: (_label, fn) => fn(),
}));

import { createOrder } from '../../src/services/order/orderCreationService.js';

describe('Pricing alignment between ML estimates and order creation charges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('charges the ML-estimated price as order total when ML price prediction is available', async () => {
    mockPredictPrice.mockResolvedValue({
      estimatedPricePaisa: 250000, // ₹2,500
    });

    mockRpc.mockResolvedValue({
      data: {
        id: 'ord-123',
        order_display_id: 'TRX-1001',
      },
      error: null,
    });

    const orderData = {
      pickup_address: 'Mumbai, Maharashtra',
      pickup_lat: 19.076,
      pickup_lng: 72.877,
      drop_address: 'Pune, Maharashtra',
      drop_lat: 18.520,
      drop_lng: 73.856,
      pickup_date: '2026-10-01',
      pickup_time: '10:00',
      goods_type: 'General',
      weight_tonnes: 5,
    };

    await createOrder({
      orderData,
      userId: 'cust-1',
      user: { fullName: 'Customer 1' },
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'create_order_tx',
      expect.objectContaining({
        p_total_amount: 250000,
        p_estimated_price: 250000,
        p_platform_fee: 12500, // 5% of 250000
      })
    );
  });

  it('falls back to formula pricing when ML price prediction fails', async () => {
    mockPredictPrice.mockRejectedValue(new Error('ML service down'));

    mockRpc.mockResolvedValue({
      data: {
        id: 'ord-123',
        order_display_id: 'TRX-1001',
      },
      error: null,
    });

    const orderData = {
      pickup_address: 'Mumbai, Maharashtra',
      pickup_lat: 19.076,
      pickup_lng: 72.877,
      drop_address: 'Pune, Maharashtra',
      drop_lat: 18.520,
      drop_lng: 73.856,
      pickup_date: '2026-10-01',
      pickup_time: '10:00',
      goods_type: 'General',
      weight_tonnes: 5,
    };

    await createOrder({
      orderData,
      userId: 'cust-1',
      user: { fullName: 'Customer 1' },
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'create_order_tx',
      expect.objectContaining({
        p_estimated_price: null,
        p_total_amount: expect.any(Number),
      })
    );

    const callArgs = mockRpc.mock.calls[0][1];
    expect(callArgs.p_total_amount).toBeGreaterThan(0);
    expect(callArgs.p_base_freight).toBeGreaterThan(0);
  });
});
