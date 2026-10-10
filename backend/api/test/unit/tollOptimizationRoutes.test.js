import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { optimizeTollRoutes } = vi.hoisted(() => ({ optimizeTollRoutes: vi.fn() }));
vi.mock('../../src/services/tollOptimization.js', () => ({ optimizeTollRoutes }));

import tollOptimizationRoutes from '../../src/routes/tollOptimization.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tolls', tollOptimizationRoutes);
  return app;
}

describe('tollOptimizationRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validLoadDetails = { grossPayoutUSD: 500, axleCount: 5 };
  const validRoute = { id: 'r1', name: 'Route A', distanceMiles: 100, estimatedTimeHours: 2, baseTollUSD: 10 };

  it('returns 200 with the optimized result for a valid payload', async () => {
    optimizeTollRoutes.mockReturnValue({ recommendedRoute: { routeId: 'r1' } });

    const res = await request(makeApp())
      .post('/api/tolls/optimize')
      .send({ routes: [validRoute], loadDetails: validLoadDetails });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(optimizeTollRoutes).toHaveBeenCalledWith([validRoute], validLoadDetails);
  });

  it('returns 200 when loadDetails is omitted', async () => {
    optimizeTollRoutes.mockReturnValue({ recommendedRoute: { routeId: 'r1' } });

    const res = await request(makeApp())
      .post('/api/tolls/optimize')
      .send({ routes: [validRoute] });

    expect(res.status).toBe(200);
    expect(optimizeTollRoutes).toHaveBeenCalledWith([validRoute], undefined);
  });

  it('returns 400 when routes is missing', async () => {
    const res = await request(makeApp())
      .post('/api/tolls/optimize')
      .send({ loadDetails: validLoadDetails });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Validation failed');
  });

  it('returns 400 when routes is an empty array', async () => {
    const res = await request(makeApp()).post('/api/tolls/optimize').send({ routes: [] });

    expect(res.status).toBe(400);
  });

  it('returns 400 when a route has a negative distance', async () => {
    const res = await request(makeApp())
      .post('/api/tolls/optimize')
      .send({ routes: [{ distanceMiles: -5, estimatedTimeHours: 2 }] });

    expect(res.status).toBe(400);
  });

  it('returns 400 when a route is missing distanceMiles', async () => {
    const res = await request(makeApp())
      .post('/api/tolls/optimize')
      .send({ routes: [{ estimatedTimeHours: 2 }] });

    expect(res.status).toBe(400);
  });

  it('returns 400 for unknown top-level body fields', async () => {
    const res = await request(makeApp())
      .post('/api/tolls/optimize')
      .send({ routes: [validRoute], unexpected: true });

    expect(res.status).toBe(400);
  });

  it('returns 500 with a generic error and does not leak the internal message when the service throws', async () => {
    optimizeTollRoutes.mockImplementation(() => {
      throw new Error('S3 bucket misconfigured: workers/toll');
    });

    const res = await request(makeApp())
      .post('/api/tolls/optimize')
      .send({ routes: [validRoute] });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to optimize routes.');
    expect(JSON.stringify(res.body)).not.toContain('S3 bucket');
  });
});