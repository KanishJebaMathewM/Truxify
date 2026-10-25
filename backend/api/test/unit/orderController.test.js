import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: vi.fn() },
  mongoDb: {},
}));

vi.mock('../../src/repositories/orderRepository.js', () => ({
  OrderRepository: class {
    constructor() {}
  },
}));

vi.mock('../../src/services/order/bidAcceptanceService.js', () => ({
  BidAcceptanceService: class {},
  DomainError: class DomainError extends Error {},
}));

vi.mock('../../src/services/order/orderTimelineService.js', () => ({
  OrderTimelineService: class {},
}));

vi.mock('../../src/services/order/orderLifecycleService.js', () => ({
  OrderLifecycleService: class {},
}));

vi.mock('../../src/services/order/orderValidationService.js', () => ({
  OrderValidationService: class {},
}));

vi.mock('../../src/services/escrow.js', () => ({
  buildDepositTx: vi.fn(),
  recordDepositTx: vi.fn(),
  submitEscrowRefund: vi.fn(),
  escrowRefund: vi.fn(),
}));

vi.mock('../../src/services/ml.js', () => ({
  predictDemand: vi.fn(),
}));

vi.mock('../../src/services/osrm.js', () => ({
  buildStraightLineGeometry: vi.fn(),
  getRouteGeometry: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const orderController = await import('../../src/controllers/orderController.js');

describe('order controller exports', () => {
  it('exposes createOrder and getActiveOrders', () => {
    expect(typeof orderController.createOrder).toBe('function');
    expect(typeof orderController.getActiveOrders).toBe('function');
  });
});