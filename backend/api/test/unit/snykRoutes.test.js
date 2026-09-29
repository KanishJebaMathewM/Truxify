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

let allowAuth = true;
let allowPolicy = true;

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    if (!allowAuth) return res.status(401).json({ error: 'Authentication required' });
    req.user = { id: 'snyk-admin-1', role: 'admin' };
    next();
  },
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, res, next) => {
    if (!allowPolicy) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
}));

const snykServiceMock = vi.hoisted(() => ({
  scanDependencies: vi.fn(),
  scanContainer: vi.fn(),
  scanIaC: vi.fn(),
  scanCode: vi.fn(),
  monitorProject: vi.fn(),
  getVulnerabilities: vi.fn(),
  createFixPR: vi.fn(),
  getProjects: vi.fn(),
  getStats: vi.fn(),
}));

vi.mock('../../../../snyk/snyk.service.js', () => ({
  default: snykServiceMock,
}));

const snykRouter = (await import('../../../../snyk/routes.js')).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', snykRouter);
  return app;
}

describe('Snyk API route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowAuth = true;
    allowPolicy = true;
  });

  it('runs a dependency scan for an authorized admin', async () => {
    const result = { vulnerabilities: 2 };
    snykServiceMock.scanDependencies.mockResolvedValue(result);

    const res = await request(makeApp())
      .post('/api/snyk/scan/dependencies')
      .send({ path: '.' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: result });
    expect(snykServiceMock.scanDependencies).toHaveBeenCalledWith('.');
  });

  it('rejects policy-denied Snyk operations', async () => {
    allowPolicy = false;

    const res = await request(makeApp())
      .post('/api/snyk/scan/dependencies')
      .send({ path: '.' });

    expect(res.status).toBe(403);
    expect(snykServiceMock.scanDependencies).not.toHaveBeenCalled();
  });
});
