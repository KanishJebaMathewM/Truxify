import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ──────────────────────────────────────────────────────────────
const mockStore = {
  orders: [],
  order_timeline: [],
  tracking_tokens: [],
  driver_locations: [],
};

function resetStore() {
  mockStore.orders = [];
  mockStore.order_timeline = [];
  mockStore.tracking_tokens = [];
  mockStore.driver_locations = [];
}

// Build a chainable supabase mock per table
function buildChainable(table) {
  const builder = {
    _filters: [],
    _data: null,
    _mode: null,
    _select: '*',
    _single: false,
    _maybeSingle: false,
    _orderCol: null,
    _orderAsc: true,
    _limitN: null,
    eq(col, val) { builder._filters.push({ col, op: 'eq', val }); return builder; },
    gt(col, val) { builder._filters.push({ col, op: 'gt', val }); return builder; },
    gte(col, val) { builder._filters.push({ col, op: 'gte', val }); return builder; },
    order(col, opts) { builder._orderCol = col; builder._orderAsc = opts?.ascending !== false; return builder; },
    limit(n) { builder._limitN = n; return builder; },
    select(s) { builder._select = s; return builder; },
    single() { builder._single = true; return builder; },
    maybeSingle() { builder._maybeSingle = true; return builder; },
    insert(data) { builder._mode = 'insert'; builder._data = data; return builder; },
    update(data) { builder._mode = 'update'; builder._data = data; return builder; },
    delete() { builder._mode = 'delete'; return builder; },
    then(resolve) {
      let rows = (mockStore[table] || []).slice();
      // Apply filters
      for (const f of builder._filters) {
        if (f.op === 'eq') rows = rows.filter(r => r[f.col] === f.val);
        else if (f.op === 'gt') rows = rows.filter(r => r[f.col] > f.val);
        else if (f.op === 'gte') rows = rows.filter(r => r[f.col] >= f.val);
      }
      if (builder._mode === 'insert') {
        const row = { id: 'mock-id-' + Date.now(), created_at: new Date().toISOString(), revoked: false, ...builder._data };
        if (!mockStore[table]) mockStore[table] = [];
        mockStore[table].push(row);
        return resolve({ data: builder._single ? row : [row], error: null });
      }
      if (builder._mode === 'update') {
        for (const row of rows) Object.assign(row, builder._data);
        return resolve({ data: rows[0] || null, error: null });
      }
      if (builder._single) return resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'no rows' } });
      if (builder._maybeSingle) return resolve({ data: rows[0] || null, error: null });
      return resolve({ data: rows, error: null });
    },
  };
  return builder;
}

vi.mock('../../src/config/db.js', () => ({
  supabase: {
    from(table) { return buildChainable(table); },
  },
  redisClient: {},
  mongoDb: {},
  firebaseAdmin: { auth: () => ({ verifyIdToken: async () => ({ uid: 'test-user' }) }) },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 'customer-uuid-123', role: 'customer', fullName: 'Test User' };
    next();
  },
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (req, res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  createStore: () => undefined,
  safeIpKeyGenerator: () => 'test-ip',
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// ── Route under test ─────────────────────────────────────────────────
import trackingRoutes from '../../src/routes/trackingRoutes.js';
import publicTrackingRoutes from '../../src/routes/publicTrackingRoutes.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', trackingRoutes);
  app.use('/api/public', publicTrackingRoutes);
  return app;
}

describe('Tracking Routes', () => {
  let app;

  beforeEach(() => {
    resetStore();
    // Seed an active order
    mockStore.orders.push({
      order_display_id: '#FF20241205',
      customer_id: 'customer-uuid-123',
      status: 'in_transit',
      pickup_address: 'Surat, Gujarat',
      pickup_lat: 21.17,
      pickup_lng: 72.83,
      drop_address: 'Jaipur, Rajasthan',
      drop_lat: 26.91,
      drop_lng: 75.79,
      pickup_date: '2024-12-05',
      goods_type: 'Electronics',
      weight_tonnes: 5.0,
      driver_name: 'Ravi Kumar',
      driver_rating: 4.8,
      truck_number: 'GJ05AB1234',
      eta: '6 hours',
      created_at: new Date().toISOString(),
      driver_id: 'driver-uuid-456',
    });

    mockStore.order_timeline.push(
      { order_display_id: '#FF20241205', milestone: 'Order Placed', completed: true, sort_order: 10 },
      { order_display_id: '#FF20241205', milestone: 'Truck Assigned', completed: true, sort_order: 20 },
      { order_display_id: '#FF20241205', milestone: 'In Transit', completed: true, sort_order: 50 },
    );

    app = buildApp();
  });

  describe('POST /api/orders/:id/share-tracking', () => {
    it('should generate a tracking link for a valid active order', async () => {
      const res = await request(app)
        .post('/api/orders/%23FF20241205/share-tracking')
        .set('x-user-id', 'customer-uuid-123')
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.trackingUrl).toBeDefined();
      expect(res.body.token).toBeDefined();
      expect(res.body.expiresAt).toBeDefined();
      expect(res.body.trackingUrl).toContain('/track/');
    });

    it('should return 404 for non-existent order', async () => {
      const res = await request(app)
        .post('/api/orders/NONEXISTENT/share-tracking')
        .set('x-user-id', 'customer-uuid-123')
        .send({});

      expect(res.status).toBe(404);
    });

    it('should return 403 when sharing someone else\'s order', async () => {
      mockStore.orders[0].customer_id = 'other-customer-uuid';

      const res = await request(app)
        .post('/api/orders/%23FF20241205/share-tracking')
        .set('x-user-id', 'customer-uuid-123')
        .send({});

      expect(res.status).toBe(403);
    });

    it('should return 400 for terminal orders', async () => {
      mockStore.orders[0].status = 'delivered';

      const res = await request(app)
        .post('/api/orders/%23FF20241205/share-tracking')
        .set('x-user-id', 'customer-uuid-123')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/orders/:id/share-tracking/revoke', () => {
    it('should revoke tracking tokens for an order', async () => {
      // First create a token
      await request(app)
        .post('/api/orders/%23FF20241205/share-tracking')
        .set('x-user-id', 'customer-uuid-123')
        .send({});

      // Then revoke
      const res = await request(app)
        .post('/api/orders/%23FF20241205/share-tracking/revoke')
        .set('x-user-id', 'customer-uuid-123')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/public/tracking/:token', () => {
    it('should return public tracking data for a valid token', async () => {
      // Create a token first
      const shareRes = await request(app)
        .post('/api/orders/%23FF20241205/share-tracking')
        .set('x-user-id', 'customer-uuid-123')
        .send({});

      const token = shareRes.body.token;

      const res = await request(app)
        .get(`/api/public/tracking/${token}`);

      expect(res.status).toBe(200);
      expect(res.body.order).toBeDefined();
      expect(res.body.order.order_display_id).toBe('#FF20241205');
      expect(res.body.order.status).toBe('in_transit');
      expect(res.body.timeline).toBeDefined();
      expect(res.body.timeline.length).toBe(3);
    });

    it('should NOT expose sensitive fields', async () => {
      const shareRes = await request(app)
        .post('/api/orders/%23FF20241205/share-tracking')
        .set('x-user-id', 'customer-uuid-123')
        .send({});

      const res = await request(app)
        .get(`/api/public/tracking/${shareRes.body.token}`);

      expect(res.status).toBe(200);
      const order = res.body.order;
      // Must NOT contain
      expect(order.customer_id).toBeUndefined();
      expect(order.driver_id).toBeUndefined();
      expect(order.payment_method_id).toBeUndefined();
      expect(order.upi_id).toBeUndefined();
      expect(order.blockchain_tx_hash).toBeUndefined();
      expect(order.delivery_otp).toBeUndefined();
      expect(order.total_amount).toBeUndefined();
      expect(order.platform_fee).toBeUndefined();
      expect(order.base_freight).toBeUndefined();
    });

    it('should return 404 for invalid token', async () => {
      const res = await request(app)
        .get('/api/public/tracking/invalid-token-abc123');

      expect(res.status).toBe(404);
    });

    it('should return 410 for revoked token', async () => {
      const shareRes = await request(app)
        .post('/api/orders/%23FF20241205/share-tracking')
        .set('x-user-id', 'customer-uuid-123')
        .send({});

      // Revoke
      await request(app)
        .post('/api/orders/%23FF20241205/share-tracking/revoke')
        .set('x-user-id', 'customer-uuid-123')
        .send({});

      const res = await request(app)
        .get(`/api/public/tracking/${shareRes.body.token}`);

      expect(res.status).toBe(410);
    });
  });

  describe('GET /api/public/tracking/:token/route', () => {
    it('should return route geometry for a valid token', async () => {
      const shareRes = await request(app)
        .post('/api/orders/%23FF20241205/share-tracking')
        .set('x-user-id', 'customer-uuid-123')
        .send({});

      const res = await request(app)
        .get(`/api/public/tracking/${shareRes.body.token}/route`);

      expect(res.status).toBe(200);
      expect(res.body.type).toBe('Feature');
      expect(res.body.geometry.type).toBe('LineString');
      expect(res.body.geometry.coordinates).toHaveLength(2);
      expect(res.body.properties.fallback).toBe(true);
    });
  });

  describe('Security: No auth required for public endpoint', () => {
    it('should not require authentication for GET /api/public/tracking/:token', async () => {
      const shareRes = await request(app)
        .post('/api/orders/%23FF20241205/share-tracking')
        .set('x-user-id', 'customer-uuid-123')
        .send({});

      // Request WITHOUT any auth headers
      const res = await request(app)
        .get(`/api/public/tracking/${shareRes.body.token}`);

      expect(res.status).toBe(200);
    });
  });
});
