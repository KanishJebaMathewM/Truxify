import { describe, it, expect, vi, beforeEach } from 'vitest';

const { didMock } = vi.hoisted(() => ({
  didMock: {
    issueCredential: vi.fn(),
    getCredentials: vi.fn(),
    verifyCredential: vi.fn(),
  },
}));

vi.mock('../../../did/did.service.js', () => ({ default: didMock }));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const { mockSupabaseClient, mockCreateUserClient } = vi.hoisted(() => {
  const client = {
    from: vi.fn(),
  };
  return {
    mockSupabaseClient: client,
    mockCreateUserClient: vi.fn(() => client),
  };
});

vi.mock('../../src/config/db.js', () => ({
  supabase: mockSupabaseClient,
  createUserClient: mockCreateUserClient,
}));

import {
  resolveCredentialSubject,
  loadCredential,
  handshake,
} from '../../src/controllers/escortWalletController.js';
import { AppError } from '../../src/utils/errors.js';

function makeReqRes(overrides = {}) {
  const req = {
    body: {},
    user: { id: 'user-123', role: 'driver' },
    token: 'fake-jwt-token',
    ...overrides,
  };
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
    didMock.issueCredential.mockResolvedValue({ success: true, credentialId: 'cred-999' });
  });

  describe('resolveCredentialSubject', () => {
    it('resolves caller wallet and normalized subject from profile successfully', async () => {
      const selectQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { polygon_wallet_address: ' 0xABCDEF1234567890 ' },
          error: null,
        }),
      };
      mockSupabaseClient.from.mockReturnValue(selectQuery);

      const req = {
        user: { id: 'user-123' },
        token: 'auth-token',
        body: { subject: ' 0x999888777666 ' },
      };

      const result = await resolveCredentialSubject(req);

      expect(mockCreateUserClient).toHaveBeenCalledWith('auth-token');
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('profiles');
      expect(selectQuery.eq).toHaveBeenCalledWith('id', 'user-123');
      expect(result).toEqual({
        subject: '0x999888777666',
        callerWallet: '0xabcdef1234567890',
      });
    });

    it('handles missing polygon_wallet_address and non-string subject gracefully', async () => {
      const selectQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      };
      mockSupabaseClient.from.mockReturnValue(selectQuery);

      const req = {
        user: { id: 'user-456' },
        token: 'auth-token',
        body: {},
      };

      const result = await resolveCredentialSubject(req);

      expect(result).toEqual({
        subject: '',
        callerWallet: '',
      });
    });

    it('throws AppError 500 when Supabase query returns an error', async () => {
      const selectQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database connection failed' },
        }),
      };
      mockSupabaseClient.from.mockReturnValue(selectQuery);

      const req = {
        user: { id: 'user-err' },
        token: 'auth-token',
        body: { subject: '0x123' },
      };

      await expect(resolveCredentialSubject(req)).rejects.toThrow(AppError);
    });
  });

  describe('loadCredential', () => {
    it('issues a credential with default/omitted validUntil and returns 201', async () => {
      const { req, res, next } = makeReqRes({
        body: {
          subject: '0x123',
          credentialType: 'EscortCertification',
          schema: { certId: 'CERT-001' },
        },
      });

      await loadCredential(req, res, next);

      expect(didMock.issueCredential).toHaveBeenCalledWith(
        '0x123',
        'EscortCertification',
        { certId: 'CERT-001' },
        undefined
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Credential successfully issued and loaded into IdentityWallet',
        credentialId: 'cred-999',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('issues a credential with future unix timestamp in seconds', async () => {
      const futureUnixSeconds = Math.floor((Date.now() + 100000) / 1000);
      const { req, res, next } = makeReqRes({
        body: {
          subject: '0x123',
          credentialType: 'Insurance',
          schema: { policyNumber: 'POL-100' },
          validUntil: futureUnixSeconds,
        },
      });

      await loadCredential(req, res, next);

      expect(didMock.issueCredential).toHaveBeenCalledWith(
        '0x123',
        'Insurance',
        { policyNumber: 'POL-100' },
        futureUnixSeconds
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ credentialId: 'cred-999' })
      );
    });

    it('issues a credential with future ISO date string', async () => {
      const futureIso = new Date(Date.now() + 86400000).toISOString();
      const { req, res, next } = makeReqRes({
        body: {
          subject: '0x123',
          credentialType: 'StatePermit',
          schema: { state: 'CA' },
          validUntil: futureIso,
        },
      });

      await loadCredential(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(didMock.issueCredential).toHaveBeenCalledWith(
        '0x123',
        'StatePermit',
        { state: 'CA' },
        futureIso
      );
    });

    it('returns 400 when validUntil is in the past', async () => {
      const pastUnixSeconds = Math.floor((Date.now() - 100000) / 1000);
      const { req, res, next } = makeReqRes({
        body: {
          subject: '0x123',
          credentialType: 'EscortCertification',
          schema: {},
          validUntil: pastUnixSeconds,
        },
      });

      await loadCredential(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'validUntil must be a future date (unix timestamp in seconds or ISO string)',
      });
      expect(didMock.issueCredential).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 400 when validUntil is an invalid type/string', async () => {
      const { req, res, next } = makeReqRes({
        body: {
          subject: '0x123',
          credentialType: 'EscortCertification',
          schema: {},
          validUntil: 'not-a-date',
        },
      });

      await loadCredential(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(didMock.issueCredential).not.toHaveBeenCalled();
    });

    it('calls next with error when didService returns success: false', async () => {
      didMock.issueCredential.mockResolvedValue({ success: false });

      const { req, res, next } = makeReqRes({
        body: {
          subject: '0x123',
          credentialType: 'EscortCertification',
          schema: {},
        },
      });

      await loadCredential(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('calls next with error when didService throws an exception', async () => {
      const error = new Error('Smart contract execution reverted');
      didMock.issueCredential.mockRejectedValue(error);

      const { req, res, next } = makeReqRes({
        body: {
          subject: '0x123',
          credentialType: 'EscortCertification',
          schema: {},
        },
      });

      await loadCredential(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(mockLogger.error).toHaveBeenCalledWith(
        { err: error },
        'Error in loadCredential'
      );
    });
  });

  describe('handshake', () => {
    it('returns 400 when escorts is missing, not an array, or empty', async () => {
      const { req: req1, res: res1, next: next1 } = makeReqRes({ body: {} });
      await handshake(req1, res1, next1);
      expect(res1.status).toHaveBeenCalledWith(400);
      expect(res1.json).toHaveBeenCalledWith({
        error: 'escorts must be a non-empty array of addresses',
      });

      const { req: req2, res: res2, next: next2 } = makeReqRes({
        body: { escorts: [] },
      });
      await handshake(req2, res2, next2);
      expect(res2.status).toHaveBeenCalledWith(400);
    });

    it('returns SUCCESS when all escorts have valid verified credentials', async () => {
      didMock.getCredentials.mockResolvedValue([
        { id: 'cred-1', revoked: false, type: 'EscortCertification', validUntil: 2000000000 },
        { id: 'cred-2', revoked: false, type: 'Insurance', validUntil: 2000000000 },
      ]);
      didMock.verifyCredential.mockResolvedValue({ isValid: true });

      const { req, res, next } = makeReqRes({
        body: { escorts: ['0xEscort1', '0xEscort2'] },
      });

      await handshake(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        handshake: 'SUCCESS',
        allCompliant: true,
        convoy: [
          {
            address: '0xEscort1',
            compliant: true,
            credentials: [
              { id: 'cred-1', type: 'EscortCertification', validUntil: 2000000000 },
              { id: 'cred-2', type: 'Insurance', validUntil: 2000000000 },
            ],
          },
          {
            address: '0xEscort2',
            compliant: true,
            credentials: [
              { id: 'cred-1', type: 'EscortCertification', validUntil: 2000000000 },
              { id: 'cred-2', type: 'Insurance', validUntil: 2000000000 },
            ],
          },
        ],
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns FAILED when an escort has no credentials', async () => {
      didMock.getCredentials.mockImplementation(async (address) => {
        if (address === '0xEscort1') {
          return [{ id: 'cred-1', revoked: false, type: 'Cert', validUntil: 2000000000 }];
        }
        return [];
      });
      didMock.verifyCredential.mockResolvedValue({ isValid: true });

      const { req, res, next } = makeReqRes({
        body: { escorts: ['0xEscort1', '0xEscort2'] },
      });

      await handshake(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        handshake: 'FAILED',
        allCompliant: false,
        convoy: [
          {
            address: '0xEscort1',
            compliant: true,
            credentials: [{ id: 'cred-1', type: 'Cert', validUntil: 2000000000 }],
          },
          {
            address: '0xEscort2',
            compliant: false,
            reason: 'No credentials found',
          },
        ],
      });
    });

    it('returns FAILED and filters out revoked or invalid credentials', async () => {
      didMock.getCredentials.mockResolvedValue([
        { id: 'cred-revoked', revoked: true, type: 'Cert', validUntil: 2000000000 },
        { id: 'cred-invalid', revoked: false, type: 'Cert', validUntil: 2000000000 },
      ]);
      didMock.verifyCredential.mockResolvedValue({ isValid: false });

      const { req, res, next } = makeReqRes({
        body: { escorts: ['0xEscort1'] },
      });

      await handshake(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        handshake: 'FAILED',
        allCompliant: false,
        convoy: [
          {
            address: '0xEscort1',
            compliant: false,
            credentials: [],
          },
        ],
      });
    });

    it('calls next with error when an exception is thrown in handshake', async () => {
      const error = new Error('RPC provider connection failed');
      didMock.getCredentials.mockRejectedValue(error);

      const { req, res, next } = makeReqRes({
        body: { escorts: ['0xEscort1'] },
      });

      await handshake(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(mockLogger.error).toHaveBeenCalledWith(
        { err: error },
        'Error in handshake'
      );
    });
  });
});
