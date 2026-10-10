import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const boundary = vi.hoisted(() => ({ from: vi.fn(), telemetry: [], deliveries: [], cache: new Map(), redis: { status: 'ready', get: vi.fn(), set: vi.fn() } }));
vi.mock('../../src/config/db.js', () => ({ supabaseAdmin: { from: boundary.from }, redisClient: boundary.redis }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/middleware/auth.js', () => ({ authenticate: (req, _res, next) => { req.user = { id: 'fleet-one', role: 'fleet_manager' }; next(); }, requireRole: () => (_req, _res, next) => next() }));
import { getDashboardMetrics, getPredictiveInsights } from '../../src/services/fleetAnalyticsService.js';
import analyticsRoutes from '../../src/routes/analyticsRoutes.js';
const start = '2026-01-01', end = '2026-02-01';
const delivery = late => ({ id: 'order-one', estimated_delivery_at: '2026-01-01T12:00:00Z', completed_at: late ? '2026-01-01T16:00:00Z' : '2026-01-01T12:00:00Z', customer_rating: 5 });
const driver = (id, active, idle) => ({ driver_id: id, active_hours: active, idle_hours: idle, total_distance_km: 100, total_pings: 5 });
beforeEach(() => {
  boundary.telemetry = []; boundary.deliveries = []; boundary.cache.clear();
  boundary.redis.get.mockReset().mockImplementation(async key => boundary.cache.get(key) ?? null);
  boundary.redis.set.mockReset().mockImplementation(async (key, value) => { boundary.cache.set(key, value); });
  boundary.from.mockReset().mockImplementation(table => {
    let columns;
    const query = { select: value => { columns = value; return query; }, eq: vi.fn(() => query), gte: () => query, lte: () => query,
      then: resolve => Promise.resolve({ data: table === 'driver_telemetry_daily' ? boundary.telemetry : columns.includes('estimated_delivery_at') ? boundary.deliveries : [], error: null }).then(resolve) };
    return query;
  });
});
describe('fleet utilization from telemetry rather than delivery punctuality', () => {
  it.each([
    ['low activity with punctual delivery', [driver('a', 1, 9)], [delivery(false)], 10, 100],
    ['full activity with late delivery', [driver('a', 10, 0)], [delivery(true)], 100, 0],
    ['no telemetry with punctual delivery', [], [delivery(false)], 0, 100],
    ['zero observed hours', [driver('a', 0, 0)], [delivery(false)], 0, 100],
    ['unequal driver hours', [driver('a', 1, 9), driver('b', 9, 0)], [delivery(false)], 53, 100],
  ])('%s', async (_label, telemetry, deliveries, expectedUtilization, expectedOnTime) => {
    boundary.telemetry = telemetry; boundary.deliveries = deliveries;
    const result = await getDashboardMetrics('fleet-one', start, end);
    expect(result.summary.fleetOverview.utilizationRate).toBe(expectedUtilization);
    expect(result.summary.performance.onTimeDeliveryPct).toBe(expectedOnTime);
    expect(result.deliveryPerformance.onTimePct).toBe(expectedOnTime);
  });
  it('uses all daily observations before rounding the fleet rate', async () => {
    boundary.telemetry = [driver('a', 1, 2), driver('a', 2, 1), driver('b', 4, 0)];
    boundary.deliveries = [delivery(true)];
    const result = await getDashboardMetrics('fleet-one', start, end);
    expect(result.summary.fleetOverview.utilizationRate).toBe(70);
    expect(result.driverUtilization.find(d => d.driverId === 'a').daysTracked).toBe(2);
  });
  it('caches the corrected summary and serves it without querying again', async () => {
    boundary.telemetry = [driver('a', 1, 9)]; boundary.deliveries = [delivery(false)];
    const first = await getDashboardMetrics('fleet-one', start, end);
    const queries = boundary.from.mock.calls.length;
    const cached = await getDashboardMetrics('fleet-one', start, end);
    expect(cached.summary.fleetOverview.utilizationRate).toBe(10);
    expect(cached).toEqual(first);
    expect(boundary.from).toHaveBeenCalledTimes(queries);
    expect(boundary.redis.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', 300);
  });
  it('reports low utilization even when every delivery is punctual', async () => {
    boundary.telemetry = [driver('a', 1, 9)]; boundary.deliveries = [delivery(false)];
    const result = await getPredictiveInsights('fleet-one');
    expect(result.insights.map(i => i.title)).toContain('Low Fleet Utilization');
    expect(result.insights.map(i => i.title)).not.toContain('Poor On-Time Performance');
  });
  it('does not report low utilization solely because deliveries are late', async () => {
    boundary.telemetry = [driver('a', 9, 1)]; boundary.deliveries = [delivery(true)];
    const result = await getPredictiveInsights('fleet-one');
    expect(result.insights.map(i => i.title)).not.toContain('Low Fleet Utilization');
    expect(result.insights.map(i => i.title)).toContain('Poor On-Time Performance');
  });
  it('returns separate utilization and punctuality through the mounted dashboard route', async () => {
    boundary.telemetry = [driver('a', 1, 9)]; boundary.deliveries = [delivery(false)];
    const app = express(); app.use('/api/analytics', analyticsRoutes);
    const response = await request(app).get('/api/analytics/dashboard').query({ startDate: start, endDate: end });
    expect(response.status).toBe(200);
    expect(response.body.summary.fleetOverview.utilizationRate).toBe(10);
    expect(response.body.summary.performance.onTimeDeliveryPct).toBe(100);
  });
});
