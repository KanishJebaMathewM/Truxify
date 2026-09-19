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

let allowAuth = true;
let allowPolicy = true;

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    if (!allowAuth) return res.status(401).json({ error: 'Authentication required' });
    req.user = { id: 'mev-user-1', role: 'member' };
    next();
  },
  requirePolicy: () => (_req, res, next) => {
    if (!allowPolicy) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

const mevServiceMock = vi.hoisted(() => ({
  createCommitment: vi.fn(),
  createEscrow: vi.fn(),
  releaseEscrow: vi.fn(),
  submitFlashbotsBundle: vi.fn(),
  getMEVProtectionLevel: vi.fn(),
  getEscrowDetails: vi.fn(),
  getMEVStats: vi.fn(),
}));

vi.mock('../../../../mev/mev.service.js', () => ({
  default: mevServiceMock,
}));

const mevRouter = (await import('../../../../mev/routes.js')).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', mevRouter);
  return app;
}

describe('MEV API route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowAuth = true;
    allowPolicy = true;
  });

  it('creates a commitment for an authenticated caller', async () => {
    const result = { success: true, secretHash: '0xhash' };
    mevServiceMock.createCommitment.mockResolvedValue(result);

    const res = await request(makeApp())
      .post('/api/mev/commitment')
      .send({ secret: 'client-secret', userId: 'mev-user-1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: result });
    expect(mevServiceMock.createCommitment).toHaveBeenCalledWith('client-secret', 'mev-user-1');
  });

  it('rejects unauthenticated MEV requests before service execution', async () => {
    allowAuth = false;

    const res = await request(makeApp())
      .post('/api/mev/commitment')
      .send({ secret: 'client-secret', userId: 'mev-user-1' });

    expect(res.status).toBe(401);
    expect(mevServiceMock.createCommitment).not.toHaveBeenCalled();
  });

  it('rejects policy-denied MEV operations', async () => {
    allowPolicy = false;

    const res = await request(makeApp())
      .post('/api/mev/commitment')
      .send({ secret: 'client-secret', userId: 'mev-user-1' });

    expect(res.status).toBe(403);
    expect(mevServiceMock.createCommitment).not.toHaveBeenCalled();
  });
});
