/**
 * Integration tests for the IDOR fix on:
 *   GET /api/orders/:id/driver-location
 *   GET /api/orders/:id/route
 *
 * Unlike most integration suites, these run the REAL requirePolicy middleware
 * and the REAL policy engine, so the ownership checks are exercised
 * end-to-end through the HTTP stack:
 *   - Owner customer  -> 200
 *   - Assigned driver -> 200
 *   - Admin           -> 200
 *   - Unrelated user  -> 403
 *   - Unauthenticated -> 401
 *   - Non-existent order -> 403 (resource resolves to undefined -> fail-closed)
 *
 * The `authenticate` middleware runs in BYPASS_AUTH + ENABLE_TEST_AUTH mode,
 * reading `x-user-id` / `x-user-role` headers (set in test/setup.js).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const routeEstimateMock = vi.fn();
const getRouteGeometryMock = vi.fn();

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

let mockMongoDb = null;
afterEach(() => {
  mockMongoDb = null;
  routeEstimateMock.mockReset();
  routeEstimateMock.mockResolvedValue(null);
  getRouteGeometryMock.mockReset();
  getRouteGeometryMock.mockResolvedValue(null);
});

vi.mock('../../src/config/db.js', () => ({
  supabase: m.supabase,
  supabaseAdmin: null,
  firebaseAdmin: null,
  get redisClient() {
    return null;
  },
  get mongoDb() {
    return mockMongoDb;
  },
}));

vi.mock('../../src/sockets/tracker.js', () => ({
  initWebSocketServer: () => ({}),
  broadcastOrderMilestone: vi.fn(),
}));

vi.mock('../../src/services/osrm.js', () => ({
  getRouteEstimate: routeEstimateMock,
  getRouteGeometry: getRouteGeometryMock,
  buildStraightLineGeometry: ({ originLat, originLng, destLat, destLng }) => ({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [originLng, originLat],
        [destLng, destLat],
      ],
    },
    properties: { fallback: true },
  }),
}));

vi.mock('../../src/services/reputation.js', () => ({
  reputationContract: {},
  awardReputationPoints: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/escrow.js', async () => {
  const actual = await vi.importActual('../../src/services/escrow.js');
  return {
    ...actual,
    escrowRelease: vi.fn(),
    submitEscrowRefund: vi.fn(),
    confirmEscrowRefund: vi.fn(),
  };
});

vi.mock('../../src/services/ml.js', () => ({
  predictDemand: vi.fn(),
  predictPrice: vi.fn(),
  matchEnRouteLoads: vi.fn(),
}));

// NOTE: requirePolicy + policyEngine are intentionally NOT mocked so the
// ownership checks run for real.
const { default: orderRouter } = await import('../../src/routes/orderRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', orderRouter);
  return app;
}

function seedOrder(overrides = {}) {
  const order = {
    id: '00000000-0000-0000-0000-000000000001',
    customer_id: '00000000-0000-0000-0000-000000000abc',
    driver_id: '00000000-0000-0000-0000-000000000def',
    status: 'in_transit',
    pickup_lat: 19.076,
    pickup_lng: 72.8777,
    drop_lat: 28.7041,
    drop_lng: 77.1025,
    ...overrides,
  };
  m.store.orders.push(order);
  return order;
}

function seedTelemetry(orderId, driverId) {
  mockMongoDb = {
    collection: () => ({
      find: () => ({
        sort: () => ({
          limit: () => ({
            toArray: async () => [
              {
                driver_id: driverId,
                order_id: orderId,
                lat: 25.5,
                lng: 74.5,
                timestamp: new Date().toISOString(),
              },
            ],
          }),
        }),
      }),
    }),
  };
}

const CUSTOMER_HEADERS = {
  'x-user-id': '00000000-0000-0000-0000-000000000abc',
  'x-user-role': 'customer',
};
const DRIVER_HEADERS = {
  'x-user-id': '00000000-0000-0000-0000-000000000def',
  'x-user-role': 'driver',
};
const ADMIN_HEADERS = {
  'x-user-id': '00000000-0000-0000-0000-000000000999',
  'x-user-role': 'admin',
};
const OTHER_HEADERS = {
  'x-user-id': '00000000-0000-0000-0000-000000000777',
  'x-user-role': 'customer',
};

describe('GET /api/orders/:id/driver-location — IDOR (issue #7478)', () => {
  beforeEach(() => {
    m.store.orders = [];
    seedOrder();
    seedTelemetry('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000def');
  });

  it('owner customer can fetch assigned driver location', async () => {
    const res = await request(buildApp())
      .get('/api/orders/00000000-0000-0000-0000-000000000001/driver-location')
      .set(CUSTOMER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.driverId).toBe('00000000-0000-0000-0000-000000000def');
    expect(res.body.lat).toBe(25.5);
    expect(res.body.lng).toBe(74.5);
  });

  it('assigned driver can fetch own location', async () => {
    const res = await request(buildApp())
      .get('/api/orders/00000000-0000-0000-0000-000000000001/driver-location')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(200);
  });

  it('admin can fetch any driver location', async () => {
    const res = await request(buildApp())
      .get('/api/orders/00000000-0000-0000-0000-000000000001/driver-location')
      .set(ADMIN_HEADERS);

    expect(res.status).toBe(200);
  });

  it('unrelated user is denied with 403', async () => {
    const res = await request(buildApp())
      .get('/api/orders/00000000-0000-0000-0000-000000000001/driver-location')
      .set(OTHER_HEADERS);

    expect(res.status).toBe(403);
  });

  it('unauthenticated request is rejected with 401', async () => {
    const res = await request(buildApp()).get(
      '/api/orders/00000000-0000-0000-0000-000000000001/driver-location'
    );

    expect(res.status).toBe(401);
  });

  it('non-existent order is denied with 403 (fail-closed, no ownership leak)', async () => {
    const res = await request(buildApp())
      .get('/api/orders/00000000-0000-0000-0000-00000000dead/driver-location')
      .set(CUSTOMER_HEADERS);

    expect(res.status).toBe(403);
  });

  it('returns 404 when no telemetry exists for an authorized user', async () => {
    mockMongoDb = {
      collection: () => ({
        find: () => ({
          sort: () => ({
            limit: () => ({
              toArray: async () => [],
            }),
          }),
        }),
      }),
    };
    const res = await request(buildApp())
      .get('/api/orders/00000000-0000-0000-0000-000000000001/driver-location')
      .set(CUSTOMER_HEADERS);

    expect(res.status).toBe(404);
  });

  it('returns 404 when no driver is assigned', async () => {
    seedOrder({
      id: '00000000-0000-0000-0000-000000000002',
      driver_id: null,
    });
    const res = await request(buildApp())
      .get('/api/orders/00000000-0000-0000-0000-000000000002/driver-location')
      .set(CUSTOMER_HEADERS);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('No driver assigned to this order.');
  });
});

describe('GET /api/orders/:id/route — IDOR (issue #7478)', () => {
  beforeEach(() => {
    m.store.orders = [];
    seedOrder();
    seedTelemetry('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000def');
    getRouteGeometryMock.mockResolvedValue({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [72.8777, 19.076],
          [77.1025, 28.7041],
        ],
      },
      properties: { distance: 1000, duration: 60 },
    });
  });

  it('owner customer can fetch route for assigned order', async () => {
    const res = await request(buildApp())
      .get('/api/orders/00000000-0000-0000-0000-000000000001/route')
      .set(CUSTOMER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.geometry.type).toBe('LineString');
  });

  it('assigned driver can fetch route', async () => {
    const res = await request(buildApp())
      .get('/api/orders/00000000-0000-0000-0000-000000000001/route')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(200);
  });

  it('admin can fetch any route', async () => {
    const res = await request(buildApp())
      .get('/api/orders/00000000-0000-0000-0000-000000000001/route')
      .set(ADMIN_HEADERS);

    expect(res.status).toBe(200);
  });

  it('unrelated user is denied with 403', async () => {
    const res = await request(buildApp())
      .get('/api/orders/00000000-0000-0000-0000-000000000001/route')
      .set(OTHER_HEADERS);

    expect(res.status).toBe(403);
  });

  it('unauthenticated request is rejected with 401', async () => {
    const res = await request(buildApp()).get(
      '/api/orders/00000000-0000-0000-0000-000000000001/route'
    );

    expect(res.status).toBe(401);
  });

  it('non-existent order is denied with 403 (fail-closed, no ownership leak)', async () => {
    const res = await request(buildApp())
      .get('/api/orders/00000000-0000-0000-0000-00000000dead/route')
      .set(CUSTOMER_HEADERS);

    expect(res.status).toBe(403);
  });

  it('owner customer can fetch straight-line fallback route when no driver assigned', async () => {
    seedOrder({
      id: '00000000-0000-0000-0000-000000000003',
      driver_id: null,
    });
    const res = await request(buildApp())
      .get('/api/orders/00000000-0000-0000-0000-000000000003/route')
      .set(CUSTOMER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.fallback).toBe(true);
    expect(res.body.geometry.type).toBe('LineString');
  });
});
