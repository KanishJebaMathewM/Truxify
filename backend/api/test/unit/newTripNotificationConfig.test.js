import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), send: vi.fn() }));
vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: { rpc: mocks.rpc, from: mocks.from }, supabase: null,
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/services/order/bidAcceptanceService.js', async () => import('../../src/services/order/domainError.js'));
vi.mock('../../src/services/osrm.js', () => ({ getRouteEstimate: vi.fn(async () => null), validateCoordinates: () => null }));
vi.mock('../../src/services/ml.js', () => ({ predictPrice: vi.fn(async () => null) }));
vi.mock('../../src/services/trafficService.js', () => ({ getLiveTrafficMultiplier: vi.fn(async () => 1) }));
vi.mock('../../src/services/notificationService.js', () => ({ sendFcmNotification: mocks.send }));

const drivers = Array.from({ length: 65 }, (_, i) => ({ user_id: `driver-${i}`, truck_id: `truck-${i}` }));
const input = {
  userId: 'customer-one', orderData: {
    pickup_address: 'Delhi', pickup_lat: 28.6, pickup_lng: 77.2,
    drop_address: 'Mumbai', drop_lat: 19.1, drop_lng: 72.9,
    weight_tonnes: 5, goods_type: 'Electronics',
  },
};

describe('new-trip notification configuration through order creation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    for (const name of ['NEW_TRIP_NOTIFY_MAX_DRIVERS', 'NEW_TRIP_NOTIFY_BATCH_SIZE', 'NEW_TRIP_NOTIFY_RADIUS_KM']) {
      vi.stubEnv(name, '');
    }
    mocks.send.mockResolvedValue({ success: true });
    mocks.rpc.mockImplementation(async name => name === 'create_order_tx'
      ? { data: { id: 'order-one' } }
      : { data: drivers.map(d => ({ driver_id: d.user_id })) });
    mocks.from.mockImplementation(table => {
      const query = {
        select: () => query, eq: () => query, not: () => query, in: () => query,
        then: resolve => resolve({ data: table === 'driver_details' ? drivers
          : drivers.map(d => ({ id: d.truck_id, max_capacity_tons: 10 })) }),
      };
      return query;
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it.each(['0.5', 'Infinity', '1e100', 'NaN', '-2'])('falls back from invalid driver count %s', async value => {
    vi.stubEnv('NEW_TRIP_NOTIFY_MAX_DRIVERS', value);
    const { createOrder } = await import('../../src/services/order/orderCreationService.js');
    await createOrder(input);
    expect(mocks.send).toHaveBeenCalledTimes(50);
    expect(new Set(mocks.send.mock.calls.map(call => call[0])).size).toBe(50);
  });

  it('avoids empty notification batches with a fractional batch size', async () => {
    vi.stubEnv('NEW_TRIP_NOTIFY_MAX_DRIVERS', '5');
    vi.stubEnv('NEW_TRIP_NOTIFY_BATCH_SIZE', '0.5');
    const settled = vi.spyOn(Promise, 'allSettled');
    const { createOrder } = await import('../../src/services/order/orderCreationService.js');
    await createOrder(input);
    expect(mocks.send).toHaveBeenCalledTimes(5);
    expect(settled.mock.calls.map(([batch]) => batch.length)).toEqual([5]);
  });

  it('preserves valid integer limits and batches', async () => {
    vi.stubEnv('NEW_TRIP_NOTIFY_MAX_DRIVERS', '5');
    vi.stubEnv('NEW_TRIP_NOTIFY_BATCH_SIZE', '2');
    const settled = vi.spyOn(Promise, 'allSettled');
    const { createOrder } = await import('../../src/services/order/orderCreationService.js');
    await createOrder(input);
    expect(mocks.send.mock.calls.map(call => call[0])).toEqual(drivers.slice(0, 5).map(d => d.user_id));
    expect(settled.mock.calls.map(([batch]) => batch.length)).toEqual([2, 2, 1]);
  });

  it.each(['Infinity', '1e100', 'NaN'])('uses default batches for invalid batch count %s', async value => {
    vi.stubEnv('NEW_TRIP_NOTIFY_BATCH_SIZE', value);
    const settled = vi.spyOn(Promise, 'allSettled');
    const { createOrder } = await import('../../src/services/order/orderCreationService.js');
    await createOrder(input);
    expect(mocks.send).toHaveBeenCalledTimes(50);
    expect(settled.mock.calls.map(([batch]) => batch.length)).toEqual([25, 25]);
  });

  it('uses the default finite radius instead of querying with infinity', async () => {
    vi.stubEnv('NEW_TRIP_NOTIFY_RADIUS_KM', 'Infinity');
    const { createOrder } = await import('../../src/services/order/orderCreationService.js');
    await createOrder(input);
    expect(mocks.rpc).toHaveBeenCalledWith('get_nearby_active_drivers', expect.objectContaining({ radius_meters: 50000 }));
  });

  it('preserves a valid fractional radius', async () => {
    vi.stubEnv('NEW_TRIP_NOTIFY_RADIUS_KM', '2.5');
    const { createOrder } = await import('../../src/services/order/orderCreationService.js');
    await createOrder(input);
    expect(mocks.rpc).toHaveBeenCalledWith('get_nearby_active_drivers', expect.objectContaining({ radius_meters: 2500 }));
  });

  it('rejects a finite radius that overflows when converted to meters', async () => {
    vi.stubEnv('NEW_TRIP_NOTIFY_RADIUS_KM', '1e308');
    const { createOrder } = await import('../../src/services/order/orderCreationService.js');
    await createOrder(input);
    expect(mocks.rpc).toHaveBeenCalledWith('get_nearby_active_drivers', expect.objectContaining({ radius_meters: 50000 }));
  });
});
