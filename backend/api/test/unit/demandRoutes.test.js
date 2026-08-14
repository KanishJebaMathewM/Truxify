import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/config/db.js', () => ({
  createUserClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        in: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      })),
    })),
  })),
  supabase: null,
}));

vi.mock('../../src/services/ml.js', () => ({
  predictDemand: vi.fn().mockResolvedValue({ predicted_demand: 0.7 }),
}));

vi.mock('../../src/config/demand.js', () => ({
  demandConfig: {
    baseEarningRate: 10,
    routeMultiplierBase: 1.0,
    routeMultiplierStep: 0.1,
    next24HoursFactor: 0.8,
    next48HoursFactor: 1.2,
    peakHours: [9, 10, 11, 14, 15, 16],
  },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('demandRoutes', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    const demandRoutes = (await import('../../src/routes/demandRoutes.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api/demand-heatmap', demandRoutes);
  });

  it('GET / responds with 200 and GeoJSON structure when authenticated', async () => {
    const res = await request(app)
      .get('/api/demand-heatmap/')
      .set('Authorization', 'Bearer test-token');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('type', 'FeatureCollection');
    expect(res.body).toHaveProperty('features');
    expect(Array.isArray(res.body.features)).toBe(true);
  });

  it('returns routeSuggestions in response', async () => {
    const res = await request(app)
      .get('/api/demand-heatmap/')
      .set('Authorization', 'Bearer test-token');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('routeSuggestions');
    expect(res.body).toHaveProperty('estimatedEarningPotential');
    expect(res.body).toHaveProperty('predictedDemandNext48Hours');
    expect(res.body).toHaveProperty('repositioningAreas');
  });

  it('accepts vehicle_type filter parameter', async () => {
    const res = await request(app)
      .get('/api/demand-heatmap/?vehicle_type=truck')
      .set('Authorization', 'Bearer test-token');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('filtersApplied');
  });

  it('accepts cargo_category filter parameter', async () => {
    const res = await request(app)
      .get('/api/demand-heatmap/?cargo_category=electronics')
      .set('Authorization', 'Bearer test-token');
    expect(res.status).toBe(200);
  });
});
