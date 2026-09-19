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
    req.user = { id: 'ebpf-admin-1', role: 'admin' };
    next();
  },
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, res, next) => {
    if (!allowPolicy) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
}));

const ebpfRouter = (await import('../../../ebpf/routes.js')).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', ebpfRouter);
  return app;
}

describe('eBPF API route contract', () => {
  beforeEach(() => {
    allowAuth = true;
    allowPolicy = true;
  });

  it('returns metrics for an authorized caller', async () => {
    const res = await request(makeApp()).get('/api/ebpf/metrics');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });

  it('rejects a caller denied by the eBPF management policy', async () => {
    allowPolicy = false;

    const res = await request(makeApp()).get('/api/ebpf/metrics');

    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated callers before route execution', async () => {
    allowAuth = false;

    const res = await request(makeApp()).get('/api/ebpf/metrics');

    expect(res.status).toBe(401);
  });
});
