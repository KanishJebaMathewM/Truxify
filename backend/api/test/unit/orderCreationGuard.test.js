import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  get supabase() { return null; },
  get supabaseAdmin() { return { rpc: vi.fn() }; },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/core/performanceMetrics.js', () => ({
  measureExecution: (_name, fn) => fn(),
}));

vi.mock('../../src/lib/orderDisplayId.js', () => ({
  generateOrderDisplayId: vi.fn(() => 'TEST-DISPLAY-ID'),
  ORDER_DISPLAY_ID_MAX_RETRIES: 1,
}));

vi.mock('../../src/services/osrm.js', () => ({
  getRouteEstimate: vi.fn().mockResolvedValue({ distanceKm: 10 }),
  validateCoordinates: vi.fn(() => null),
}));

vi.mock('../../src/lib/pricing.js', () => ({
  computeOrderPricing: vi.fn(() => ({
    baseFreight: 100, tollEstimate: 5, platformFee: 2, totalAmount: 107,
    fuelCost: 10, netProfit: 90, distanceKm: 10,
  })),
}));

vi.mock('../../src/services/trafficService.js', () => ({
  getLiveTrafficMultiplier: vi.fn().mockResolvedValue(1),
}));

vi.mock('../../src/services/ml.js', () => ({
  predictPrice: vi.fn().mockResolvedValue({ estimatedPricePaisa: 10700 }),
}));

vi.mock('../../src/services/order/bidAcceptanceService.js', () => ({
  DomainError: class extends Error {
    constructor(status, payload) { super(payload?.error || 'err'); this.status = status; this.payload = payload; }
  },
}));

import { createOrder } from '../../src/services/order/orderCreationService.js';
import { DomainError } from '../../src/services/order/bidAcceptanceService.js';

const validOrderData = {
  pickup_address: 'A', pickup_lat: 12.3, pickup_lng: 77.6,
  drop_address: 'B', drop_lat: 13.1, drop_lng: 80.2,
  goods_type: 'general', weight_tonnes: 5,
};

describe('orderCreationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws 400 when required fields are missing', async () => {
    try {
      await createOrder({ orderData: {}, userId: 'u1', user: {} });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect(e.status).toBe(400);
      expect(e.message).toContain('Missing required');
    }
  });

  it('throws 400 when coordinates are invalid', async () => {
    const { validateCoordinates } = await import('../../src/services/osrm.js');
    validateCoordinates.mockReturnValue('lat out of range');
    try {
      await createOrder({ orderData: validOrderData, userId: 'u1', user: {} });
      expect.unreachable();
    } catch (e) {
      expect(e.status).toBe(400);
      expect(e.message).toBe('lat out of range');
    }
  });
});
