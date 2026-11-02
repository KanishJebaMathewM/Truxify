import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const boundary = vi.hoisted(() => ({ rows: [], from: vi.fn() }));

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: { from: boundary.from },
  redisClient: null,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'fleet-one', role: 'fleet_manager' };
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

const { MAX_ANALYTICS_ROWS } = await import('../../src/lib/metricsAggregator.js');
const { default: analyticsRoutes } = await import('../../src/routes/analyticsRoutes.js');

const app = express();
app.use('/api/analytics', analyticsRoutes);

beforeEach(() => {
  boundary.rows = Array.from({ length: MAX_ANALYTICS_ROWS + 1 }, (_, index) => ({
    id: `row-${index}`,
    driver_id: 'driver-one',
    total_distance_km: 1,
    active_hours: 1,
    idle_hours: 0,
    total_pings: 1,
    date: '2026-10-01',
    planned_distance_km: 10,
    actual_distance_km: 10,
    fuel_cost_paisa: 100,
    total_amount: 1000,
    status: 'completed',
    completed_at: '2026-10-01T12:00:00.000Z',
    estimated_delivery_at: '2026-10-01T12:00:00.000Z',
    customer_rating: 5,
    fleet_manager_id: 'fleet-one',
  }));

  boundary.from.mockReset().mockImplementation(() => {
    let limit = null;
    const query = {
      select: () => query,
      eq: () => query,
      gte: () => query,
      lte: () => query,
      limit: (value) => {
        limit = value;
        return query;
      },
      then: (resolve) => Promise.resolve({
        data: boundary.rows.slice(0, limit ?? boundary.rows.length),
        error: null,
      }).then(resolve),
    };
    return query;
  });
});

describe('analytics row limit route responses', () => {
  it.each(['/dashboard', '/export/csv', '/export/html'])(
    'returns 413 for an oversized range on %s',
    async (path) => {
      const response = await request(app)
        .get(`/api/analytics${path}`)
        .query({ startDate: '2020-01-01T00:00:00.000Z', endDate: '2026-01-01T00:00:00.000Z' });

      expect(response.status).toBe(413);
      expect(response.body.error).toBe('Analytics range too large');
      expect(response.body.maxRows).toBe(MAX_ANALYTICS_ROWS);
      expect(response.body.message).toContain('narrow the date range');
    }
  );
});
