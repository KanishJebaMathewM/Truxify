import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('express-rate-limit', () => ({
  default: () => (_req, _res, next) => next(),
}));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

let allowAuth = true;
let allowPolicy = true;

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    if (!allowAuth) return res.status(401).json({ error: 'Authentication required' });
    req.user = { id: 'wasi-admin-1', role: 'admin' };
    next();
  },
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, res, next) => {
    if (!allowPolicy) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
}));

const wasiRuntimeMock = vi.hoisted(() => ({
  loadWasiModule: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listDirectory: vi.fn(),
  httpRequest: vi.fn(),
  getTime: vi.fn(),
  getTimeMs: vi.fn(),
  getProcessId: vi.fn(),
  getCurrentDir: vi.fn(),
  getStats: vi.fn(),
}));

vi.mock('../../../../wasi/wasi-runtime.js', () => ({
  default: wasiRuntimeMock,
}));

const wasiRouter = (await import('../../../../wasi/routes.js')).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', wasiRouter);
  return app;
}

describe('WASI API route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowAuth = true;
    allowPolicy = true;
  });

  it('loads a WASI module for an authorized caller', async () => {
    wasiRuntimeMock.loadWasiModule.mockResolvedValue('instance-1');

    const res = await request(makeApp())
      .post('/api/wasi/load')
      .send({ wasmPath: '/srv/module.wasm' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { instanceId: 'instance-1' },
    });
  });

  it('rejects policy-denied WASI operations', async () => {
    allowPolicy = false;

    const res = await request(makeApp())
      .post('/api/wasi/load')
      .send({ wasmPath: '/srv/module.wasm' });

    expect(res.status).toBe(403);
    expect(wasiRuntimeMock.loadWasiModule).not.toHaveBeenCalled();
  });
});
