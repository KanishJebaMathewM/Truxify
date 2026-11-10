import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { validation, straightLine } = vi.hoisted(() => {
  // Existing constructor wiring references an unbound refund alias on main.
  // Isolate that unrelated dependency while testing the actual route handler.
  vi.stubGlobal('submitEscrowRefund', vi.fn());
  return {
    validation: { findOrderByIdOrDisplayId: vi.fn(), assertOrderFound: vi.fn() },
    straightLine: vi.fn(),
  };
});
vi.mock('../../src/config/db.js', () => ({ supabase: {}, mongoDb: null }));
vi.mock('../../src/repositories/orderRepository.js', () => ({ OrderRepository: class {} }));
vi.mock('../../src/services/order/bidAcceptanceService.js', () => ({
  BidAcceptanceService: class {}, DomainError: class extends Error {},
}));
vi.mock('../../src/services/order/orderTimelineService.js', () => ({ OrderTimelineService: class {} }));
vi.mock('../../src/services/order/orderLifecycleService.js', () => ({ OrderLifecycleService: class {} }));
vi.mock('../../src/services/order/orderValidationService.js', () => ({
  OrderValidationService: class { constructor() { return validation; } },
}));
vi.mock('../../src/services/escrow.js', () => ({
  buildDepositTx: vi.fn(), recordDepositTx: vi.fn(), submitEscrowRefund: vi.fn(),
}));
vi.mock('../../src/services/ml.js', () => ({ predictDemand: vi.fn() }));
vi.mock('../../src/services/osrm.js', () => ({
  buildStraightLineGeometry: straightLine, getRouteGeometry: vi.fn(),
}));
vi.mock('../../src/middleware/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn() } }));
import { getLiveRouteGeometry } from '../../src/controllers/orderController.js';

afterAll(() => vi.unstubAllGlobals());

describe('unassigned order pickup coordinates', () => {
  let order;
  beforeEach(() => {
    vi.clearAllMocks();
    order = { id: 'order', customer_id: 'owner', driver_id: null,
      pickup_lat: 18.52, pickup_lng: 73.85, drop_lat: 19.07, drop_lng: 72.87 };
    validation.findOrderByIdOrDisplayId.mockImplementation(async () => order);
    straightLine.mockReturnValue({ type: 'Feature' });
  });

  async function request(userId = 'owner') {
    const res = { json: vi.fn() };
    const next = vi.fn();
    await getLiveRouteGeometry({ params: { id: 'order' }, user: { id: userId, role: 'customer' } }, res, next);
    return { res, next };
  }

  for (const field of ['pickup_lat', 'pickup_lng']) {
    for (const value of [null, undefined]) {
      it(`rejects ${field}=${value} before building any fallback geometry`, async () => {
        order[field] = value;
        const { res, next } = await request();
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
          statusCode: 500, message: 'Order is missing pickup coordinates.',
        }));
        expect(straightLine).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
      });
    }
  }

  for (const value of [0, '0']) {
    it(`preserves legitimate zero coordinates supplied as ${typeof value}`, async () => {
      order.pickup_lat = value;
      order.pickup_lng = value;
      const { res, next } = await request();
      expect(straightLine).toHaveBeenCalledWith({ originLat: 0, originLng: 0, destLat: 19.07, destLng: 72.87 });
      expect(res.json).toHaveBeenCalledWith({ type: 'Feature', fallback: true });
      expect(next).not.toHaveBeenCalled();
    });
  }

  it('still builds a normal route for complete coordinates', async () => {
    const { res, next } = await request();
    expect(res.json).toHaveBeenCalledWith({ type: 'Feature', fallback: true });
    expect(next).not.toHaveBeenCalled();
  });

  it('retains rejection of nonnumeric pickup coordinates', async () => {
    order.pickup_lat = 'invalid';
    const { next } = await request();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500, message: 'Order has invalid coordinates.' }));
    expect(straightLine).not.toHaveBeenCalled();
  });

  it('checks order ownership before revealing missing-coordinate errors', async () => {
    order.pickup_lat = null;
    const { next } = await request('other-customer');
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(straightLine).not.toHaveBeenCalled();
  });
});
