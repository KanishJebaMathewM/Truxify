import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  get: vi.fn(), set: vi.fn(), incr: vi.fn(), expire: vi.fn(), route: vi.fn(), traffic: vi.fn(),
}));
vi.mock('../../src/config/db.js', () => ({ redisClient: boundary, supabaseAdmin: null }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/services/osrm.js', () => ({ getRouteEstimate: boundary.route }));
vi.mock('../../src/services/trafficService.js', () => ({ getLiveTrafficMultiplier: boundary.traffic }));
vi.mock('../../src/services/routingService.js', () => ({ getHaversineDistance: vi.fn().mockReturnValue(1) }));
vi.mock('../../src/sockets/tracker.js', () => ({ broadcastOrderEta: vi.fn() }));
vi.mock('../../src/sockets/locationServer.js', () => ({ emitEtaUpdateToBooking: vi.fn() }));

import { maybeRecalculateEtaOnLocationUpdate, resolveDestinationForOrder } from '../../src/services/order/etaService.js';

describe('ETA destination coordinates', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    boundary.get.mockResolvedValue(null);
    boundary.incr.mockResolvedValue(1);
    boundary.route.mockResolvedValue({ durationSeconds: 300 });
    boundary.traffic.mockResolvedValue(1);
  });

  it.each([null, undefined, '', '  ', false, true, [], [12], {}, NaN, Infinity].map(value => [value]))(
    'rejects malformed latitude %j instead of coercing it to a destination', value => {
      expect(resolveDestinationForOrder({ status: 'in_transit', drop_lat: value, drop_lng: 77 })).toBeNull();
    },
  );

  it.each([[91, 77], [-91, 77], [12, 181], [12, -181], [12, null], [12, '']])(
    'rejects invalid destination pair (%j, %j)', (lat, lng) => {
      expect(resolveDestinationForOrder({ status: 'en_route_pickup', pickup_lat: lat, pickup_lng: lng })).toBeNull();
    },
  );

  it('preserves zero, boundary coordinates and numeric database strings', () => {
    expect(resolveDestinationForOrder({ status: 'in_transit', drop_lat: 0, drop_lng: 0 })).toEqual({ lat: 0, lng: 0 });
    expect(resolveDestinationForOrder({ status: 'in_transit', drop_lat: '-90', drop_lng: '180' })).toEqual({ lat: -90, lng: 180 });
    expect(resolveDestinationForOrder({ status: 'arrived_pickup', pickup_lat: '12.5', pickup_lng: '77.1', drop_lat: 13, drop_lng: 78 })).toEqual({ lat: 12.5, lng: 77.1 });
  });

  it('skips routing and persistence on live updates with a missing destination', async () => {
    const repository = {
      findOrderById: vi.fn().mockResolvedValue({ data: { id: 'order', driver_id: 'driver', status: 'in_transit', drop_lat: null, drop_lng: 77 } }),
      updateOrderWithFilter: vi.fn().mockResolvedValue({ data: { id: 'order', status: 'in_transit' } }),
    };
    await maybeRecalculateEtaOnLocationUpdate({ orderRepository: repository, orderId: 'order', driverId: 'driver', lat: 12, lng: 77 });
    expect(boundary.route).not.toHaveBeenCalled();
    expect(repository.updateOrderWithFilter).not.toHaveBeenCalled();
    expect(boundary.incr).not.toHaveBeenCalled();
  });

  it('continues routing and persisting valid numeric-string destinations', async () => {
    const repository = {
      findOrderById: vi.fn().mockResolvedValue({ data: { id: 'order', driver_id: 'driver', status: 'in_transit', drop_lat: '13', drop_lng: '78' } }),
      updateOrderWithFilter: vi.fn().mockResolvedValue({ data: { id: 'order', status: 'in_transit' } }),
    };
    await maybeRecalculateEtaOnLocationUpdate({ orderRepository: repository, orderId: 'order', driverId: 'driver', lat: 12, lng: 77 });
    expect(boundary.route).toHaveBeenCalledWith({ pickupLat: 12, pickupLng: 77, dropLat: 13, dropLng: 78 });
    expect(repository.updateOrderWithFilter).toHaveBeenCalledTimes(1);
  });
});
