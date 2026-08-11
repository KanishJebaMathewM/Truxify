import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// requireRole.js does not exist on main (issue #8701); the route imports it
// so the test must provide a stub using the route-relative specifier.
vi.mock('../middleware/requireRole.js', () => ({
  requireRole: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'u1' }; next(); },
}));

const { ctrlMock } = vi.hoisted(() => ({
  ctrlMock: {
    loadCredential: vi.fn(),
    handshake: vi.fn(),
  },
}));

vi.mock('../../src/controllers/escortWalletController.js', () => ctrlMock);

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import escortWalletRoutes from '../../src/routes/escortWalletRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/escort', escortWalletRoutes);
  return app;
}

describe('escortWalletRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctrlMock.loadCredential.mockImplementation((req, res) => res.status(201).json({ ok: true }));
    ctrlMock.handshake.mockImplementation((req, res) => res.status(200).json({ ok: true }));
  });

  it('routes POST /escort/credential to loadCredential', async () => {
    const res = await request(makeApp()).post('/escort/credential').send({ subject: '0x1', credentialType: 'T', schema: {} });
    expect(res.status).toBe(201);
    expect(ctrlMock.loadCredential).toHaveBeenCalled();
  });

  it('routes POST /escort/handshake to handshake', async () => {
    const res = await request(makeApp()).post('/escort/handshake').send({ escorts: ['0x1'] });
    expect(res.status).toBe(200);
    expect(ctrlMock.handshake).toHaveBeenCalled();
  });
});
