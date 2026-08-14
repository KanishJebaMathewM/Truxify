import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import orderRoutes from '../../src/routes/orderRoutes.js';

vi.mock('../../src/core/container.js', () => ({
  orderRepository: {},
  orderValidationService: {},
  orderTimelineService: {},
  orderMilestoneService: {},
  orderLifecycleService: {},
  deliveryVerificationService: {},
  buildDepositTx: vi.fn(),
  recordDepositTx: vi.fn(),
  submitEscrowRefund: vi.fn(),
  confirmEscrowRefund: vi.fn(),
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'u1' }; next(); },
  requireRole: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

const { dbMock, mlMock } = vi.hoisted(() => ({
  dbMock: { supabaseAdmin: { from: vi.fn() } },
  mlMock: { matchEnRouteLoads: vi.fn() },
}));

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: dbMock.supabaseAdmin,
  supabase: {},
  mongoDb: {},
  redisClient: {},
  createUserClient: () => ({}),
}));

vi.mock('../../src/services/ml.js', () => ({
  predictDemand: vi.fn(),
  predictPrice: vi.fn(),
  matchEnRouteLoads: mlMock.matchEnRouteLoads,
}));

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 'driver-1' };
  next();
});
app.use(orderRoutes);

function chain(result) {
  const q = {
    then: (onFulfilled) => Promise.resolve(result).then(onFulfilled),
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    ilike: vi.fn(() => q),
    gte: vi.fn(() => q),
    lte: vi.fn(() => q),
    or: vi.fn(() => q),
    order: vi.fn(() => q),
    range: vi.fn(() => q),
    in: vi.fn(() => q),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
  return q;
}

describe('GET /api/orders/load-offers/en-route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.supabaseAdmin.from.mockReset();
    mlMock.matchEnRouteLoads.mockReset();
  });

  it('returns all available offers when no coordinates are provided', async () => {
    const q = chain({ data: [{ id: 'l1', pickup_address: 'A', drop_address: 'B', freight_value: 10000 }], error: null });
    dbMock.supabaseAdmin.from.mockReturnValue(q);
    const res = await request(app).get('/load-offers/en-route');
    expect(res.status).toBe(200);
    expect(res.body.loads).toHaveLength(1);
    expect(res.body.loads[0].pickup).toBe('A');
    expect(res.body.loads[0].estimated_price).toBe(100);
    expect(dbMock.supabaseAdmin.from).toHaveBeenCalledWith('load_offers');
    expect(mlMock.matchEnRouteLoads).not.toHaveBeenCalled();
  });

  it('ranks offers through matchEnRouteLoads when coordinates are provided', async () => {
    const q = chain({ data: [{ id: 'l1', pickup_address: 'A', drop_address: 'B', freight_value: 10000 }], error: null });
    dbMock.supabaseAdmin.from.mockReturnValue(q);
    mlMock.matchEnRouteLoads.mockResolvedValue([{ id: 'l1', detour_km: 4.2, match_score: 0.9 }]);
    const res = await request(app)
      .get('/load-offers/en-route')
      .query({ current_lat: '19.076', current_lng: '72.877', max_detour_km: '50' });
    expect(res.status).toBe(200);
    expect(mlMock.matchEnRouteLoads).toHaveBeenCalledWith({
      currentLat: 19.076,
      currentLng: 72.877,
      offers: [{ id: 'l1', pickup_address: 'A', drop_address: 'B', freight_value: 10000, pickup: 'A', destination: 'B', estimated_price: 100, vehicle_type: 'Truck' }],
      maxDetourKm: 50,
    });
    expect(res.body.loads[0].match_score).toBe(0.9);
  });

  it('returns 400 when max_detour_km is not positive', async () => {
    const res = await request(app)
      .get('/load-offers/en-route')
      .query({ current_lat: '19.076', current_lng: '72.877', max_detour_km: '-5' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 500 when the database query fails', async () => {
    const q = chain({ data: null, error: { message: 'db down' } });
    dbMock.supabaseAdmin.from.mockReturnValue(q);
    const res = await request(app).get('/load-offers/en-route');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to fetch en-route load offers.');
  });
});
