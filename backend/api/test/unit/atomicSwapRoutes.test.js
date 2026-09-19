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
    req.user = { id: 'swap-user-1', role: 'member' };
    next();
  },
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, res, next) => {
    if (!allowPolicy) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
}));

const swapServiceMock = vi.hoisted(() => ({
  createSwap: vi.fn(),
  executeSwap: vi.fn(),
  refundSwap: vi.fn(),
  createCrossChainSwap: vi.fn(),
  executeCrossChainSwap: vi.fn(),
  refundCrossChainSwap: vi.fn(),
  getSwapStats: vi.fn(),
  getSwap: vi.fn(),
  getCrossChainSwap: vi.fn(),
}));

vi.mock('../../../atomic-swap/swap.service.js', () => ({
  default: swapServiceMock,
}));

const swapRouter = (await import('../../../atomic-swap/routes.js')).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', swapRouter);
  return app;
}

describe('Atomic swap API route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowAuth = true;
    allowPolicy = true;
  });

  it('returns swap statistics for an authenticated caller', async () => {
    const stats = { active: 2, completed: 7 };
    swapServiceMock.getSwapStats.mockResolvedValue(stats);

    const res = await request(makeApp())
      .get('/api/swap/stats');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: stats });
    expect(swapServiceMock.getSwapStats).toHaveBeenCalledOnce();
  });

  it('rejects protected swap mutations when policy denies access', async () => {
    allowPolicy = false;

    const res = await request(makeApp())
      .post('/api/swap/create')
      .send({
        counterparty: '0x1234567890123456789012345678901234567890',
        amount: '1',
        secret: 'client-secret',
        signature: 'invalid',
      });

    expect(res.status).toBe(403);
    expect(swapServiceMock.createSwap).not.toHaveBeenCalled();
  });

  it('rejects malformed swap creation before signature or service execution', async () => {
    const res = await request(makeApp())
      .post('/api/swap/create')
      .send({ counterparty: '0x1234567890123456789012345678901234567890' });

    expect(res.status).toBe(400);
    expect(swapServiceMock.createSwap).not.toHaveBeenCalled();
  });
});
