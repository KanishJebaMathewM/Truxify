import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const tokenServiceMock = vi.hoisted(() => ({
  validateToken: vi.fn(),
  getOrderForPublicTracking: vi.fn(),
  getOrderTimeline: vi.fn(),
  getDriverLocation: vi.fn(),
}));

vi.mock('../../src/services/trackingTokenService.js', () => ({
  TrackingTokenService: class {
    constructor() {}
    validateToken = tokenServiceMock.validateToken;
    getOrderForPublicTracking = tokenServiceMock.getOrderForPublicTracking;
    getOrderTimeline = tokenServiceMock.getOrderTimeline;
    getDriverLocation = tokenServiceMock.getDriverLocation;
  },
}));

const gpsLogMock = vi.hoisted(() => ({
  find: vi.fn(),
}));

vi.mock('../../src/models/GpsLog.js', () => ({
  default: gpsLogMock,
}));

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: supabaseMock,
  supabaseAdmin: null,
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  createStore: () => null,
  safeIpKeyGenerator: () => 'ip',
}));

const { default: publicTrackingRouter } = await import('../../src/routes/publicTrackingRoutes.js');

function makeApp() {
  const app = express();
  app.use('/api/public', publicTrackingRouter);
  return app;
}

const ORDER = {
  order_display_id: 'FF20260811ABC123456789',
  status: 'in_transit',
  pickup_address: 'Pune',
  drop_address: 'Mumbai',
  driver_name: 'Driver A',
  created_at: '2026-08-11T00:00:00.000Z',
};

describe('publicTrackingRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /tracking/:token returns the public order subset', async () => {
    tokenServiceMock.validateToken.mockResolvedValue({ valid: true, orderDisplayId: 'FF20260811ABC123456789' });
    tokenServiceMock.getOrderForPublicTracking.mockResolvedValue(ORDER);
    tokenServiceMock.getOrderTimeline.mockResolvedValue([]);
    tokenServiceMock.getDriverLocation.mockResolvedValue(null);

    const res = await request(makeApp()).get('/api/public/tracking/valid-token');

    expect(res.status).toBe(200);
    expect(res.body.order.order_display_id).toBe('FF20260811ABC123456789');
    expect(res.body.order).not.toHaveProperty('customer_id');
    expect(res.body.timeline).toEqual([]);
  });

  it('GET /tracking/:token returns 404 for a not-found token', async () => {
    tokenServiceMock.validateToken.mockResolvedValue({ valid: false, reason: 'not_found' });
    const res = await request(makeApp()).get('/api/public/tracking/bad-token');
    expect(res.status).toBe(404);
  });

  it('GET /tracking/:token returns 410 for a revoked token', async () => {
    tokenServiceMock.validateToken.mockResolvedValue({ valid: false, reason: 'revoked' });
    const res = await request(makeApp()).get('/api/public/tracking/revoked-token');
    expect(res.status).toBe(410);
  });

  it('GET /tracking/:token returns 410 for an expired token', async () => {
    tokenServiceMock.validateToken.mockResolvedValue({ valid: false, reason: 'expired' });
    const res = await request(makeApp()).get('/api/public/tracking/expired-token');
    expect(res.status).toBe(410);
  });

  it('GET /tracking/:token/route returns a LineString for valid coordinates', async () => {
    tokenServiceMock.validateToken.mockResolvedValue({ valid: true, orderDisplayId: 'FF20260811ABC123456789' });
    supabaseMock.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: { pickup_lat: 18.5, pickup_lng: 73.8, drop_lat: 19.0, drop_lng: 72.8, driver_id: 'd1' },
              error: null,
            }),
        }),
      }),
    });

    const res = await request(makeApp()).get('/api/public/tracking/valid-token/route');

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('Feature');
    expect(res.body.geometry.type).toBe('LineString');
    expect(res.body.geometry.coordinates).toHaveLength(2);
  });

  it('GET /tracking/:token/route returns 422 when coordinates are missing', async () => {
    tokenServiceMock.validateToken.mockResolvedValue({ valid: true, orderDisplayId: 'FF20260811ABC123456789' });
    supabaseMock.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { pickup_lat: null }, error: null }),
        }),
      }),
    });

    const res = await request(makeApp()).get('/api/public/tracking/valid-token/route');
    expect(res.status).toBe(422);
  });

  it('GET /tracking/:token/history returns bounded GPS points', async () => {
    tokenServiceMock.validateToken.mockResolvedValue({ valid: true, orderDisplayId: ORDER.order_display_id });
    const lean = vi.fn().mockResolvedValue([
      { lat: 19.1, lng: 73.1, speed: 42, heading: 90, timestamp: '2026-08-11T10:00:00.000Z' },
    ]);
    const limit = vi.fn().mockReturnValue({ lean });
    const sort = vi.fn().mockReturnValue({ limit });
    gpsLogMock.find.mockReturnValue({ sort });

    const res = await request(makeApp()).get('/api/public/tracking/valid-token/history?limit=10');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      points: [{ latitude: 19.1, longitude: 73.1, speed: 42, heading: 90, timestamp: '2026-08-11T10:00:00.000Z' }],
      count: 1,
      limit: 10,
    });
    expect(gpsLogMock.find).toHaveBeenCalledWith({ bookingId: ORDER.order_display_id });
  });

  it('GET /tracking/:token/history rejects invalid query bounds', async () => {
    tokenServiceMock.validateToken.mockResolvedValue({ valid: true, orderDisplayId: ORDER.order_display_id });

    const res = await request(makeApp()).get('/api/public/tracking/valid-token/history?limit=501');

    expect(res.status).toBe(422);
    expect(tokenServiceMock.validateToken).not.toHaveBeenCalled();
  });
});
