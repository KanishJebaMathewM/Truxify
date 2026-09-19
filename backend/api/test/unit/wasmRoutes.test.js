import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

let allowPolicy = true;

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'wasm-admin-1', role: 'admin' };
    next();
  },
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, res, next) => {
    if (!allowPolicy) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
}));

const edgeRuntimeMock = vi.hoisted(() => ({
  calculateRoute: vi.fn(),
  processDrivers: vi.fn(),
  optimizeLoads: vi.fn(),
  calculateETA: vi.fn(),
  getFunctionStats: vi.fn(),
}));

vi.mock('../../../../wasm/edge-runtime.js', () => ({
  default: edgeRuntimeMock,
}));

const wasmRouter = (await import('../../../../wasm/routes.js')).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', wasmRouter);
  return app;
}

describe('WASM API route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowPolicy = true;
  });

  it('calculates a public route successfully', async () => {
    const result = { distance: 10, eta: 20 };
    edgeRuntimeMock.calculateRoute.mockResolvedValue(result);

    const res = await request(makeApp())
      .post('/api/wasm/route')
      .send({ origin: 'A', destination: 'B' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(result);
  });

  it('rejects denied access to the protected WASM statistics route', async () => {
    allowPolicy = false;

    const res = await request(makeApp()).get('/api/wasm/stats');

    expect(res.status).toBe(403);
    expect(edgeRuntimeMock.getFunctionStats).not.toHaveBeenCalled();
  });
});
