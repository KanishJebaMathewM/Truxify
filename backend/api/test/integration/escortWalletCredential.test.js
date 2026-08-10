import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const state = vi.hoisted(() => ({
  role: 'driver',
  wallet: '0x1111111111111111111111111111111111111111',
  didService: { issueCredential: vi.fn() },
}));

vi.mock('../../../did/did.service.js', () => ({ default: state.didService }));

vi.mock('../../src/config/db.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: state.wallet ? { polygon_wallet_address: state.wallet } : null,
            error: null,
          })),
        })),
      })),
    })),
  },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 'user-1', role: state.role };
    next();
  },
}));

const { default: escortWalletRoutes } = await import('../../src/routes/escortWalletRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/escorts/wallet', escortWalletRoutes);
  return app;
}

function credentialPayload(subject, overrides = {}) {
  return {
    subject,
    credentialType: 'EscortCertification',
    schema: { cert: 'escort-cert' },
    ...overrides,
  };
}

describe('escort wallet credential issuance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.role = 'driver';
    state.wallet = '0x1111111111111111111111111111111111111111';
    state.didService.issueCredential.mockResolvedValue({ success: true, credentialId: 'cred-1' });
  });

  it('lets a driver issue a credential for their own wallet', async () => {
    const res = await request(buildApp())
      .post('/api/escorts/wallet/credential')
      .send(credentialPayload(state.wallet));

    expect(res.status).toBe(201);
    expect(state.didService.issueCredential).toHaveBeenCalledWith(
      state.wallet,
      'EscortCertification',
      expect.any(Object),
      undefined
    );
  });

  it('blocks a non-admin from issuing a credential for another subject', async () => {
    const otherWallet = '0x2222222222222222222222222222222222222222';

    const res = await request(buildApp())
      .post('/api/escorts/wallet/credential')
      .send(credentialPayload(otherWallet));

    expect(res.status).toBe(403);
    expect(state.didService.issueCredential).not.toHaveBeenCalled();
  });

  it('blocks a non-admin with no linked wallet from issuing any credential', async () => {
    state.wallet = null;

    const res = await request(buildApp())
      .post('/api/escorts/wallet/credential')
      .send(credentialPayload('0x2222222222222222222222222222222222222222'));

    expect(res.status).toBe(403);
    expect(state.didService.issueCredential).not.toHaveBeenCalled();
  });

  it('lets an admin issue a credential for any subject', async () => {
    state.role = 'admin';
    const anySubject = '0x2222222222222222222222222222222222222222';

    const res = await request(buildApp())
      .post('/api/escorts/wallet/credential')
      .send(credentialPayload(anySubject));

    expect(res.status).toBe(201);
    expect(state.didService.issueCredential).toHaveBeenCalledWith(anySubject, 'EscortCertification', expect.any(Object), undefined);
  });

  it('rejects a backdated validUntil', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;

    const res = await request(buildApp())
      .post('/api/escorts/wallet/credential')
      .send(credentialPayload(state.wallet, { validUntil: past }));

    expect(res.status).toBe(400);
    expect(state.didService.issueCredential).not.toHaveBeenCalled();
  });

  it('rejects a subject that is not a 0x address', async () => {
    const res = await request(buildApp())
      .post('/api/escorts/wallet/credential')
      .send(credentialPayload('not-an-address'));

    expect(res.status).toBe(400);
    expect(state.didService.issueCredential).not.toHaveBeenCalled();
  });
});
