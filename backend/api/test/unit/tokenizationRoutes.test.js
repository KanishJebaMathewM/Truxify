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

vi.mock('../../src/config/db.js', () => ({
  supabase: {},
}));

let allowAuth = true;
let allowPolicy = true;

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    if (!allowAuth) return res.status(401).json({ error: 'Authentication required' });
    req.user = { id: 'token-user-1', role: 'member' };
    next();
  },
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, res, next) => {
    if (!allowPolicy) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
}));

const tokenServiceMock = vi.hoisted(() => ({
  createAsset: vi.fn(),
  purchaseFraction: vi.fn(),
  sellFraction: vi.fn(),
  createTradeOrder: vi.fn(),
  executeTradeOrder: vi.fn(),
  getAsset: vi.fn(),
  getFractionalOwnership: vi.fn(),
  getStats: vi.fn(),
  getRelayerSigner: vi.fn(),
}));

vi.mock('../../../../tokenization/token.service.js', () => ({
  default: tokenServiceMock,
}));

const tokenizationRouter = (await import('../../../../tokenization/routes.js')).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', tokenizationRouter);
  return app;
}

describe('Tokenization API route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowAuth = true;
    allowPolicy = true;
  });

  it('returns a public asset lookup using the documented success envelope', async () => {
    const asset = { assetId: 'asset-1', owner: '0xowner' };
    tokenServiceMock.getAsset.mockResolvedValue(asset);

    const res = await request(makeApp())
      .get('/api/token/asset/asset-1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: asset });
    expect(tokenServiceMock.getAsset).toHaveBeenCalledWith('asset-1');
  });

  it('rejects protected token mutations when their policy denies access', async () => {
    allowPolicy = false;

    const res = await request(makeApp())
      .post('/api/token/fraction/purchase')
      .send({ assetId: 'asset-1', amount: '10' });

    expect(res.status).toBe(403);
    expect(tokenServiceMock.purchaseFraction).not.toHaveBeenCalled();
  });

  it('rejects malformed token purchases before wallet or service work', async () => {
    const res = await request(makeApp())
      .post('/api/token/fraction/purchase')
      .send({ assetId: 'asset-1' });

    expect(res.status).toBe(400);
    expect(tokenServiceMock.purchaseFraction).not.toHaveBeenCalled();
  });
});
