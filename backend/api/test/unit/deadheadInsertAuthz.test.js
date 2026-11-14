import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() { return global.__deadheadClient; },
  supabase: null,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/core/performanceMetrics.js', () => ({
  measureExecution: (_name, fn) => fn(),
}));

vi.mock('../../src/services/osrm.js', () => ({
  getRouteEstimate: vi.fn(),
}));

vi.mock('../../src/services/routingService.js', () => ({
  getHaversineDistance: vi.fn(),
}));

const { default: deadheadMatchingService } = await import('../../src/services/order/deadheadMatchingService.js');

const ORDER_ID = 'ORDER-12345678';
const OFFER_ID = 'OFFER-12345678';

function createSupabaseClient({ order, offer, claim, orderUpdate, rollback = { error: null } }) {
  const calls = [];

  function createBuilder(table) {
    const state = { table, operation: 'select', payload: null };
    const builder = {
      select() { return builder; },
      update(payload) {
        state.operation = 'update';
        state.payload = payload;
        calls.push({ table, operation: 'update', payload });
        return builder;
      },
      eq() { return builder; },
      in() { return builder; },
      single: async () => {
        if (table === 'orders' && state.operation === 'select') return order;
        if (table === 'load_offers' && state.operation === 'select') return offer;
        if (table === 'orders' && state.operation === 'update') return orderUpdate;
        return { data: null, error: null };
      },
      maybeSingle: async () => {
        if (table === 'load_offers' && state.operation === 'update') return claim;
        return { data: null, error: null };
      },
      then(resolve, reject) {
        const result = table === 'load_offers' && state.operation === 'update'
          ? rollback
          : { data: null, error: null };
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return builder;
  }

  return {
    calls,
    client: {
      from(table) {
        calls.push({ table, operation: 'from' });
        return createBuilder(table);
      },
    },
  };
}

function baseOrder(overrides = {}) {
  return {
    id: ORDER_ID,
    driver_id: 'driver-1',
    status: 'in_transit',
    waypoints: [],
    ...overrides,
  };
}

function baseOffer(overrides = {}) {
  return {
    id: OFFER_ID,
    status: 'available',
    pickup_lat: 28.61,
    pickup_lng: 77.20,
    drop_lat: 28.70,
    drop_lng: 77.30,
    pickup_location: 'Pickup',
    drop_location: 'Drop',
    ...overrides,
  };
}

describe('deadhead insert mid-trip authorization and offer claim', () => {
  beforeEach(() => {
    global.__deadheadClient = null;
  });

  it('rejects a driver who is not assigned to the order before reading offers', async () => {
    const mock = createSupabaseClient({
      order: { data: baseOrder({ driver_id: 'driver-2' }), error: null },
    });
    global.__deadheadClient = mock.client;

    await expect(deadheadMatchingService.insertMidTripLoad({
      orderId: ORDER_ID,
      loadOfferId: OFFER_ID,
      driverId: 'driver-1',
    })).rejects.toMatchObject({ status: 403 });

    expect(mock.calls.some((call) => call.table === 'load_offers')).toBe(false);
  });

  it('rejects insertion into a terminal order', async () => {
    const mock = createSupabaseClient({
      order: { data: baseOrder({ status: 'delivered' }), error: null },
    });
    global.__deadheadClient = mock.client;

    await expect(deadheadMatchingService.insertMidTripLoad({
      orderId: ORDER_ID,
      loadOfferId: OFFER_ID,
      driverId: 'driver-1',
    })).rejects.toMatchObject({ status: 409 });

    expect(mock.calls.some((call) => call.table === 'load_offers')).toBe(false);
  });

  it('rejects an offer that is no longer available', async () => {
    const mock = createSupabaseClient({
      order: { data: baseOrder(), error: null },
      offer: { data: baseOffer({ status: 'claimed' }), error: null },
    });
    global.__deadheadClient = mock.client;

    await expect(deadheadMatchingService.insertMidTripLoad({
      orderId: ORDER_ID,
      loadOfferId: OFFER_ID,
      driverId: 'driver-1',
    })).rejects.toMatchObject({ status: 409 });

    expect(mock.calls.some((call) => call.operation === 'update')).toBe(false);
  });

  it('rejects an offer with invalid coordinates before claiming it', async () => {
    const mock = createSupabaseClient({
      order: { data: baseOrder(), error: null },
      offer: { data: baseOffer({ pickup_lat: NaN }), error: null },
    });
    global.__deadheadClient = mock.client;

    await expect(deadheadMatchingService.insertMidTripLoad({
      orderId: ORDER_ID,
      loadOfferId: OFFER_ID,
      driverId: 'driver-1',
    })).rejects.toMatchObject({ status: 422 });

    expect(mock.calls.some((call) => call.operation === 'update')).toBe(false);
  });

  it('claims the offer before updating the order and returns the new waypoints', async () => {
    const updatedOrder = baseOrder({
      waypoints: [{ id: 'existing' }, { id: `wp-pickup-${OFFER_ID.slice(0, 8)}` }],
    });
    const mock = createSupabaseClient({
      order: { data: baseOrder(), error: null },
      offer: { data: baseOffer(), error: null },
      claim: { data: { id: OFFER_ID }, error: null },
      orderUpdate: { data: updatedOrder, error: null },
    });
    global.__deadheadClient = mock.client;

    const result = await deadheadMatchingService.insertMidTripLoad({
      orderId: ORDER_ID,
      loadOfferId: OFFER_ID,
      driverId: 'driver-1',
    });

    expect(result.success).toBe(true);
    expect(result.waypoints).toHaveLength(2);
    expect(result.waypoints[0]).toMatchObject({ type: 'mid_trip_pickup', load_id: OFFER_ID });
    expect(result.waypoints[1]).toMatchObject({ type: 'mid_trip_drop', load_id: OFFER_ID });
    expect(result.order).toEqual(updatedOrder);

    const updateCalls = mock.calls.filter((call) => call.operation === 'update');
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0].table).toBe('load_offers');
    expect(updateCalls[0].payload).toMatchObject({ status: 'claimed' });
    expect(updateCalls[1].table).toBe('orders');
    expect(updateCalls[1].payload.waypoints).toHaveLength(2);
  });

  it('does not update the order when the conditional offer claim loses a race', async () => {
    const mock = createSupabaseClient({
      order: { data: baseOrder(), error: null },
      offer: { data: baseOffer(), error: null },
      claim: { data: null, error: null },
    });
    global.__deadheadClient = mock.client;

    await expect(deadheadMatchingService.insertMidTripLoad({
      orderId: ORDER_ID,
      loadOfferId: OFFER_ID,
      driverId: 'driver-1',
    })).rejects.toMatchObject({ status: 409 });

    const orderUpdates = mock.calls.filter(
      (call) => call.table === 'orders' && call.operation === 'update'
    );
    expect(orderUpdates).toHaveLength(0);
  });

  it('rolls back the offer claim when the order update fails', async () => {
    const mock = createSupabaseClient({
      order: { data: baseOrder(), error: null },
      offer: { data: baseOffer(), error: null },
      claim: { data: { id: OFFER_ID }, error: null },
      orderUpdate: { data: null, error: { message: 'order update failed' } },
      rollback: { error: null },
    });
    global.__deadheadClient = mock.client;

    await expect(deadheadMatchingService.insertMidTripLoad({
      orderId: ORDER_ID,
      loadOfferId: OFFER_ID,
      driverId: 'driver-1',
    })).rejects.toMatchObject({ status: 500 });

    const offerUpdates = mock.calls.filter(
      (call) => call.table === 'load_offers' && call.operation === 'update'
    );
    expect(offerUpdates).toHaveLength(2);
    expect(offerUpdates[1].payload).toMatchObject({ status: 'available' });
  });

  it('rejects a call without a driver identity', async () => {
    await expect(deadheadMatchingService.insertMidTripLoad({
      orderId: ORDER_ID,
      loadOfferId: OFFER_ID,
    })).rejects.toMatchObject({ status: 400 });
  });
});
