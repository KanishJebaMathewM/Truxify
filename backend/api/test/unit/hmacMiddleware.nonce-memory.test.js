import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isTimestampValid: vi.fn(),
  verifySignature: vi.fn(),
  isNonceValid: vi.fn(),
}));

vi.mock('../../src/services/hmacService.js', () => ({
  default: mocks,
}));

import { hmacAuth } from '../../src/middleware/hmacMiddleware.js';

const makeRequest = () => ({
  headers: {
    'x-hmac-signature': 'signature',
    'x-timestamp': String(Date.now()),
    'x-nonce': 'nonce-1',
  },
  method: 'POST',
  body: { amount: 100 },
  originalUrl: '/api/test',
});

const makeResponse = () => ({
  status: vi.fn().mockReturnThis(),
  json: vi.fn(),
});

describe('hmacAuth nonce lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTimestampValid.mockReturnValue(true);
    mocks.verifySignature.mockReturnValue(true);
    mocks.isNonceValid.mockResolvedValue(true);
  });

  it('does not reserve an attacker-controlled nonce when HMAC verification fails', async () => {
    mocks.verifySignature.mockReturnValue(false);

    const req = makeRequest();
    const res = makeResponse();
    const next = vi.fn();

    await hmacAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mocks.isNonceValid).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('reserves the nonce only after successful HMAC verification', async () => {
    const req = makeRequest();
    const res = makeResponse();
    const next = vi.fn();

    await hmacAuth(req, res, next);

    expect(mocks.verifySignature).toHaveBeenCalledTimes(1);
    expect(mocks.isNonceValid).toHaveBeenCalledWith('nonce-1');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects a validly signed request when the nonce has already been consumed', async () => {
    mocks.isNonceValid.mockResolvedValue(false);

    const req = makeRequest();
    const res = makeResponse();
    const next = vi.fn();

    await hmacAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns service unavailable when replay protection is unavailable', async () => {
    mocks.isNonceValid.mockRejectedValue(new Error('Redis unavailable'));

    const req = makeRequest();
    const res = makeResponse();
    const next = vi.fn();

    await hmacAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });
});
