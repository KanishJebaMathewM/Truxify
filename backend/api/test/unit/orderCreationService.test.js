import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn();
const mockGetRouteEstimate = vi.fn();
const mockComputeOrderPricing = vi.fn();
const mockPredictPrice = vi.fn();
const mockGetLiveTrafficMultiplier = vi.fn();

vi.mock('../../src/config/db.js', () => ({
  supabase: {},
  supabaseAdmin: { rpc: mockRpc },
}));

vi.mock('../../src/services/osrm.js', () => ({
  getRouteEstimate: mockGetRouteEstimate,
  validateCoordinates: vi.fn(() => null),
}));

vi.mock('../../src/lib/pricing.js', () => ({
  computeOrderPricing: mockComputeOrderPricing,
}));

vi.mock('../../src/services/ml.js', () => ({
  predictPrice: mockPredictPrice,
}));

vi.mock('../../src/services/trafficService.js', () => ({
  getLiveTrafficMultiplier: mockGetLiveTrafficMultiplier,
}));

describe('orderCreationService', () => {
  let createOrder;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    const module = await import('../../src/services/order/orderCreationService.js');
    createOrder = module.createOrder;

    mockRpc.mockImplementation((fnName) =>
      fnName === 'create_order_tx'
        ? { data: { id: 'order-new' }, error: null }
        : { data: [], error: null },
    );
    mockGetRouteEstimate.mockResolvedValue({ distanceKm: 100 });
    mockComputeOrderPricing.mockReturnValue({
      distanceKm: 100,
      baseFreight: 5000,
      tollEstimate: 500,
      platformFee: 200,
      totalAmount: 5700,
      fuelCost: 1800,
      netProfit: 300,
    });
    mockPredictPrice.mockResolvedValue({ estimatedPricePaisa: 570000 });
    mockGetLiveTrafficMultiplier.mockResolvedValue(1.0);
  });

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

  describe('createOrder', () => {
    it('rejects orders missing required fields', async () => {
      await expect(createOrder({ orderData: {}, userId: 'cust-1', user: {} })).rejects.toThrow('Missing required');
    });

    it('rejects invalid coordinates', async () => {
      const { validateCoordinates } = await import('../../src/services/osrm.js');
      validateCoordinates.mockReturnValue('Invalid coordinates');
      const orderData = { ...validOrderData, pickup_lat: 999, pickup_lng: 999 };

      await expect(createOrder({ orderData, userId: 'cust-1', user: {} })).rejects.toThrow('Invalid coordinates');
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('creates an order via the transaction RPC', async () => {
      const result = await createOrder({
        orderData: validOrderData,
        userId: 'cust-1',
        user: { fullName: 'Test Customer' },
      });

      expect(mockRpc).toHaveBeenCalledWith('create_order_tx', expect.objectContaining({
        p_customer_id: 'cust-1',
        p_pickup_address: 'Delhi',
        p_total_amount: 5700,
      }));
      expect(result.order).toEqual({ id: 'order-new' });
    });
  });
});
