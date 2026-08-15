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

const mlServiceMock = vi.hoisted(() => ({
  predictEta: vi.fn(),
}));

vi.mock('../../src/services/ml.js', () => ({
  predictEta: mlServiceMock.predictEta,
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    req.user = req.headers['x-test-user']
      ? { id: req.headers['x-test-user'], role: req.headers['x-test-role'] || 'customer' }
      : { id: 'u1', role: 'customer' };
    next();
  },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (req, res, next) => next(),
}));

const supabaseChain = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        or: vi.fn(() => ({
          maybeSingle: supabaseChain.maybeSingle,
        })),
        eq: vi.fn(() => ({
          maybeSingle: supabaseChain.maybeSingle,
        })),
      })),
    })),
  },
}));

const { default: mlRouter } = await import('../../src/routes/mlRoutes.js');

function makeApp() {
  const app = express();
  app.use('/api/ml', mlRouter);
  return app;
}

describe('mlRoutes GET /eta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseChain.maybeSingle.mockReset();
  });

  it('returns 400 when tripId is missing', async () => {
    const res = await request(makeApp()).get('/api/ml/eta');
    expect(res.status).toBe(400);
  });

  it('returns 404 when the trip is not found', async () => {
    supabaseChain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const res = await request(makeApp()).get('/api/ml/eta?tripId=nope');
    expect(res.status).toBe(404);
  });

  it('returns 422 when the order has no destination', async () => {
    supabaseChain.maybeSingle
      .mockResolvedValueOnce({ data: { id: 't1', order_id: 'o1' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    const res = await request(makeApp()).get('/api/ml/eta?tripId=t1');
    expect(res.status).toBe(422);
  });

  it('returns the ETA prediction for an owner', async () => {
    supabaseChain.maybeSingle
      .mockResolvedValueOnce({ data: { id: 't1', order_id: 'o1', trip_display_id: 'TD-1' }, error: null })
      .mockResolvedValueOnce({
        data: {
          pickup_lat: 18.5, pickup_lng: 73.8,
          drop_lat: 19.0, drop_lng: 72.8,
          customer_id: 'u1', driver_id: 'd1',
        },
        error: null,
      });

    mlServiceMock.predictEta.mockResolvedValue({
      eta_minutes: 45,
      confidence_interval: { lower: 40, upper: 50 },
    });

    const res = await request(makeApp()).get('/api/ml/eta?tripId=t1');

    expect(res.status).toBe(200);
    expect(res.body.eta_minutes).toBe(45);
    expect(res.body.source).toBe('ml');
    expect(res.body.position_source).toBe('pickup');
    expect(mlServiceMock.predictEta).toHaveBeenCalledWith(
      expect.objectContaining({ routeType: expect.any(String) }),
    );
  });

  it('rejects a live position at (0,0)', async () => {
    supabaseChain.maybeSingle
      .mockResolvedValueOnce({ data: { id: 't1', order_id: 'o1' }, error: null })
      .mockResolvedValueOnce({
        data: { pickup_lat: 18.5, pickup_lng: 73.8, drop_lat: 19.0, drop_lng: 72.8, customer_id: 'u1', driver_id: 'd1' },
        error: null,
      });

    const res = await request(makeApp()).get('/api/ml/eta?tripId=t1&lat=0&lng=0');
    expect(res.status).toBe(422);
  });

  it('requires lat and lng together', async () => {
    supabaseChain.maybeSingle
      .mockResolvedValueOnce({ data: { id: 't1', order_id: 'o1' }, error: null })
      .mockResolvedValueOnce({
        data: { pickup_lat: 18.5, pickup_lng: 73.8, drop_lat: 19.0, drop_lng: 72.8, customer_id: 'u1', driver_id: 'd1' },
        error: null,
      });

    const res = await request(makeApp()).get('/api/ml/eta?tripId=t1&lat=12.9');
    expect(res.status).toBe(400);
  });

  it('rejects a tripId containing PostgREST filter-breaking characters', async () => {
    const res = await request(makeApp()).get(
      '/api/ml/eta?tripId=00000000-0000-0000-0000-000000000000).neq.id',
    );
    expect(res.status).toBe(400);
  });

  it('rejects a tripId containing commas or quotes', async () => {
    const res = await request(makeApp()).get('/api/ml/eta?tripId=abc,def');
    expect(res.status).toBe(400);
  });

  it('denies non-owners with 404', async () => {
    supabaseChain.maybeSingle
      .mockResolvedValueOnce({ data: { id: 't1', order_id: 'o1' }, error: null })
      .mockResolvedValueOnce({
        data: { pickup_lat: 18.5, pickup_lng: 73.8, drop_lat: 19.0, drop_lng: 72.8, customer_id: 'someone-else', driver_id: 'd1' },
        error: null,
      });

    const res = await request(makeApp()).get('/api/ml/eta?tripId=t1');
    expect(res.status).toBe(404);
  });
});
