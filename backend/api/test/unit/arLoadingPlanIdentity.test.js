import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/logger.js', () => ({ default: { info: vi.fn() } }));
vi.mock('../../src/middleware/rateLimiter.js', () => ({ userLimiter: (_req, _res, next) => next() }));
vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: req.headers['x-test-owner'] || 'owner-a', role: 'carrier' };
    next();
  },
}));
import router from '../../src/routes/arLoadingRoutes.js';
import { arLoadingOptimizerService } from '../../src/services/arLoadingOptimizerService.js';

const app = express();
app.use(express.json());
app.use('/api/ar-loading', router);
const payload = { container: {}, pallets: [{ id: 'pallet', weightKg: 500 }] };

beforeEach(() => arLoadingOptimizerService.loadingPlans.clear());
afterEach(() => vi.restoreAllMocks());

describe('AR loading plan identity through real routes and service', () => {
  it('retrieves and verifies the ID returned by optimization', async () => {
    const created = await request(app).post('/api/ar-loading/optimize').send(payload);
    expect(created.status).toBe(201);
    const id = created.body.plan.planId;
    const fetched = await request(app).get(`/api/ar-loading/plan/${id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.plan).toEqual(created.body.plan);
    const verified = await request(app).post(`/api/ar-loading/verify/${id}`);
    expect(verified.status).toBe(200);
    expect(verified.body.plan.status).toBe('VERIFIED_PHYSICALLY_LOADED');
  });

  it('retains both owners plans when created in the same millisecond', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1791268200000);
    const [first, second] = await Promise.all([
      request(app).post('/api/ar-loading/optimize').set('x-test-owner', 'owner-a').send(payload),
      request(app).post('/api/ar-loading/optimize').set('x-test-owner', 'owner-b').send(payload),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.plan.planId).not.toBe(second.body.plan.planId);
    for (const [response, owner] of [[first, 'owner-a'], [second, 'owner-b']]) {
      const fetched = await request(app).get(`/api/ar-loading/plan/${response.body.plan.planId}`).set('x-test-owner', owner);
      expect(fetched.status).toBe(200);
      expect(fetched.body.plan.ownerId).toBe(owner);
    }
  });

  it('keeps owner checks for generated plan IDs', async () => {
    const created = await request(app).post('/api/ar-loading/optimize').send(payload);
    const path = `/api/ar-loading/plan/${created.body.plan.planId}`;
    expect((await request(app).get(path).set('x-test-owner', 'owner-b')).status).toBe(404);
    expect((await request(app).get(path)).status).toBe(200);
  });
});
