import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Wallet } from 'ethers';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

let allowDaoAuth = true;

vi.mock('../../../dao/middleware/daoAuth.js', () => ({
  requireDaoAuth: () => (req, res, next) => {
    if (!allowDaoAuth) return res.status(403).json({ error: 'Forbidden' });
    req.verifiedSigner = req.user?.wallet_address;
    next();
  },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: 'dao-user-1',
      role: 'member',
      wallet_address: '0x1111111111111111111111111111111111111111',
    };
    next();
  },
}));

const daoServiceMock = vi.hoisted(() => ({
  joinDAO: vi.fn(),
  leaveDAO: vi.fn(),
  createProposal: vi.fn(),
  castVote: vi.fn(),
  executeProposal: vi.fn(),
  getProposal: vi.fn(),
  getMember: vi.fn(),
  getDAOStats: vi.fn(),
}));

vi.mock('../../../dao/dao.service.js', () => ({
  default: daoServiceMock,
}));

const daoRouter = (await import('../../../dao/routes.js')).default;

/**
 * Builds an Express application that mounts the route under its API prefix.
 * @returns {import('express').Express} Configured Express test application.
 */
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', daoRouter);
  return app;
}

describe('DAO API route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowDaoAuth = true;
  });

  it('joins the DAO with a valid wallet signature', async () => {
    const wallet = Wallet.createRandom();
    const userAddress = wallet.address;
    const message = 'Truxify DAO\nAction: join\nuserAddress: ' + userAddress;
    const signature = await wallet.signMessage(message);
    daoServiceMock.joinDAO.mockResolvedValue({ success: true });

    const res = await request(makeApp())
      .post('/api/dao/join')
      .send({ userAddress, signature });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { success: true } });
    expect(daoServiceMock.joinDAO).toHaveBeenCalledWith(userAddress);
  });

  it('rejects DAO actions when the DAO authorization middleware denies access', async () => {
    allowDaoAuth = false;

    const res = await request(makeApp())
      .post('/api/dao/join')
      .send({
        userAddress: '0x1234567890123456789012345678901234567890',
        signature: 'invalid',
      });

    expect(res.status).toBe(403);
    expect(daoServiceMock.joinDAO).not.toHaveBeenCalled();
  });

  it('rejects malformed join requests before signature verification', async () => {
    const res = await request(makeApp())
      .post('/api/dao/join')
      .send({ userAddress: '0x1234567890123456789012345678901234567890' });

    expect(res.status).toBe(400);
    expect(daoServiceMock.joinDAO).not.toHaveBeenCalled();
  });
});
