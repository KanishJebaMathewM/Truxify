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
    req.user = { id: 'user-zkid-1', role: 'admin' };
    next();
  },
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, res, next) => {
    if (!allowPolicy) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
}));

const zkidServiceMock = vi.hoisted(() => ({
  createIdentity: vi.fn(),
  issueCredential: vi.fn(),
  verifyCredential: vi.fn(),
  revokeCredential: vi.fn(),
  createVerificationChallenge: vi.fn(),
  requestVerification: vi.fn(),
  createSelectiveDisclosure: vi.fn(),
  revokeSelectiveDisclosure: vi.fn(),
  getIdentity: vi.fn(),
  getZKIDStats: vi.fn(),
}));

vi.mock('../../../zkid/zkid.service.js', () => ({
  default: zkidServiceMock,
}));

const zkidRouter = (await import('../../../zkid/routes.js')).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', zkidRouter);
  return app;
}

describe('ZK-ID API route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowAuth = true;
    allowPolicy = true;
  });

  it('creates an identity and returns the documented success envelope', async () => {
    const result = { success: true, identityHash: '0xidentity', txHash: '0xtx' };
    zkidServiceMock.createIdentity.mockResolvedValue(result);

    const res = await request(makeApp())
      .post('/api/zkid/identity/create')
      .send({ userAddress: '0x1234567890123456789012345678901234567890' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: result });
    expect(zkidServiceMock.createIdentity).toHaveBeenCalledWith(
      '0x1234567890123456789012345678901234567890'
    );
  });

  it('rejects missing request data before invoking the service', async () => {
    const res = await request(makeApp())
      .post('/api/zkid/identity/create')
      .send({});

    expect(res.status).toBe(400);
    expect(zkidServiceMock.createIdentity).not.toHaveBeenCalled();
  });

  it('rejects requests when the required policy middleware denies access', async () => {
    allowPolicy = false;

    const res = await request(makeApp())
      .post('/api/zkid/identity/create')
      .send({ userAddress: '0x1234567890123456789012345678901234567890' });

    expect(res.status).toBe(403);
    expect(zkidServiceMock.createIdentity).not.toHaveBeenCalled();
  });
});
