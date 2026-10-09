import { describe, it, expect, vi, beforeEach } from 'vitest';

const mongoDbMock = {
  collection: vi.fn(),
};

const orderValidationServiceMock = {
  findOrderByIdOrDisplayId: vi.fn(),
  assertOrderFound: vi.fn(),
};

const osrmMock = vi.hoisted(() => ({
  getRouteGeometry: vi.fn(),
  buildStraightLineGeometry: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  mongoDb: mongoDbMock,
  supabase: {},
  supabaseAdmin: {},
  redisClient: null,
}));

vi.mock('../../src/services/order/orderValidationService.js', () => ({
  orderValidationService: orderValidationServiceMock,
  // The controller constructs this class at module load; returning the
  // shared double keeps the suite's staged lookups in effect.
  OrderValidationService: vi.fn(function () { return orderValidationServiceMock; }),
}));

vi.mock('../../src/services/osrm.js', () => ({
  getRouteGeometry: osrmMock.getRouteGeometry,
  buildStraightLineGeometry: osrmMock.buildStraightLineGeometry,
}));

const { getDriverLocation, getLiveRouteGeometry } = await import('../../src/controllers/orderController.js');

describe('Order Driver Location & Telemetry order_id scoping', () => {
  let collectionFindMock;
  let sortMock;
  let limitMock;
  let toArrayMock;

  beforeEach(() => {
    vi.clearAllMocks();

    toArrayMock = vi.fn();
    limitMock = vi.fn().mockReturnValue({ toArray: toArrayMock });
    sortMock = vi.fn().mockReturnValue({ limit: limitMock });
    collectionFindMock = vi.fn().mockReturnValue({ sort: sortMock });

    mongoDbMock.collection.mockReturnValue({
      find: collectionFindMock,
    });
  });

  it('filters telemetry by both driver_id and order_id in getDriverLocation', async () => {
    const mockOrder = {
      id: 'order-uuid-123',
      order_display_id: 'ORD-123',
      customer_id: 'cust-1',
      driver_id: 'driver-456',
      status: 'in_transit',
    };

    orderValidationServiceMock.findOrderByIdOrDisplayId.mockResolvedValue(mockOrder);

    const mockTelemetry = [
      {
        driver_id: 'driver-456',
        order_id: 'order-uuid-123',
        lat: 19.0760,
        lng: 72.8777,
        timestamp: new Date().toISOString(),
      },
    ];

    toArrayMock.mockResolvedValue(mockTelemetry);

    const req = {
      params: { id: 'ORD-123' },
      user: { id: 'cust-1', role: 'customer' },
    };

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await getDriverLocation(req, res);

    expect(mongoDbMock.collection).toHaveBeenCalledWith('telemetry');
    expect(collectionFindMock).toHaveBeenCalledWith({
      driver_id: 'driver-456',
      order_id: 'order-uuid-123',
    });
    expect(res.json).toHaveBeenCalledWith({
      driverId: 'driver-456',
      orderId: 'order-uuid-123',
      lat: 19.0760,
      lng: 72.8777,
      timestamp: mockTelemetry[0].timestamp,
    });
  });

  it('filters telemetry by both driver_id and order_id in getLiveRouteGeometry', async () => {
    const mockOrder = {
      id: 'order-uuid-789',
      customer_id: 'cust-2',
      driver_id: 'driver-456',
      status: 'in_transit',
      pickup_lat: 19.07,
      pickupLng: 72.87,
      drop_lat: 18.52,
      drop_lng: 73.85,
    };

    orderValidationServiceMock.findOrderByIdOrDisplayId.mockResolvedValue(mockOrder);

    const mockTelemetry = [
      {
        driver_id: 'driver-456',
        order_id: 'order-uuid-789',
        lat: 19.05,
        lng: 72.88,
        timestamp: new Date().toISOString(),
      },
    ];

    toArrayMock.mockResolvedValue(mockTelemetry);

    osrmMock.getRouteGeometry.mockResolvedValue({ type: 'Feature' });
    osrmMock.buildStraightLineGeometry.mockReturnValue({ type: 'Feature' });

    const req = {
      params: { id: 'order-uuid-789' },
      user: { id: 'cust-2', role: 'customer' },
    };

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await getLiveRouteGeometry(req, res);

    expect(collectionFindMock).toHaveBeenCalledWith({
      driver_id: 'driver-456',
      order_id: 'order-uuid-789',
    });
  });
});
