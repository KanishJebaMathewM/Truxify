import { describe, it, expect, vi, beforeEach } from 'vitest';

const { didMock } = vi.hoisted(() => ({
  didMock: {
    issueCredential: vi.fn(),
    getCredentials: vi.fn(),
    verifyCredential: vi.fn(),
  },
}));

vi.mock('../../../did/did.service.js', () => ({ default: didMock }));

vi.mock('express-validator', () => ({
  validationResult: vi.fn(() => ({ isEmpty: () => true, array: () => [] })),
}));

vi.mock('../errors/AppError.js', () => ({
  AppError: class extends Error {
    constructor(message, status) { super(message); this.status = status; }
  },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { loadCredential, handshake } from '../../src/controllers/escortWalletController.js';

function makeReqRes(overrides = {}) {
  const req = { body: {}, ...overrides };
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('escortWalletController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    didMock.issueCredential.mockResolvedValue({ success: true, credentialId: 'c1' });
  });

  describe('loadCredential', () => {
    it('issues a credential and returns 201', async () => {
      const { req, res, next } = makeReqRes({ body: { subject: '0x1', credentialType: 'EscortCertification', schema: {} } });
      await loadCredential(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ credentialId: 'c1' }));
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next on error', async () => {
      didMock.issueCredential.mockRejectedValue(new Error('boom'));
      const { req, res, next } = makeReqRes({ body: { subject: '0x1', credentialType: 'X', schema: {} } });
      await loadCredential(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('handshake', () => {
    it('returns 400 for an empty escorts array', async () => {
      const { req, res, next } = makeReqRes({ body: { escorts: [] } });
      await handshake(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('reports non-compliant escorts with no credentials', async () => {
      didMock.getCredentials.mockResolvedValue([]);
      const { req, res, next } = makeReqRes({ body: { escorts: ['0x1'] } });
      await handshake(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ handshake: 'FAILED', allCompliant: false }));
    });

    it('reports success when all escorts are compliant', async () => {
      didMock.getCredentials.mockResolvedValue([{ id: 'cred-1', revoked: false, type: 'Cert', validUntil: '2030-01-01' }]);
      didMock.verifyCredential.mockResolvedValue({ isValid: true });
      const { req, res, next } = makeReqRes({ body: { escorts: ['0x1'] } });
      await handshake(req, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ handshake: 'SUCCESS', allCompliant: true }));
    });
  });
});
