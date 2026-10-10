import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  requireApiKey,
  authConfig,
  keyRepo,
  keyCache,
} from '../../../src/middleware/apiKey.js';

const mockReq = (headers = {}) => ({
  headers,
  ip: '127.0.0.1',
  originalUrl: '/api/test',
});

const mockRes = () => {
  const res = {
    statusCode: null,
    jsonData: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.jsonData = data;
      return this;
    },
  };
  return res;
};

const mockNext = vi.fn();

describe('requireApiKey middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env to control VALID_API_KEYS
    delete process.env.VALID_API_KEYS;
  });

  // The middleware reads its key set through module singletons built at
  // import time, so each test refreshes them after pointing the env at
  // the keys it needs. Without this every case sees an empty key set.
  function useKeys(rawKeys) {
    delete process.env.VALID_API_KEYS;
    keyRepo.keyStore.clear();
    keyCache.clear();
    if (rawKeys !== undefined) {
      process.env.VALID_API_KEYS = rawKeys;
    }
    authConfig.reload();
  }

  it('returns 503 when VALID_API_KEYS is not configured', () => {
    const req = mockReq();
    const res = mockRes();
    const next = mockNext;

    requireApiKey(req, res, next);

    expect(res.statusCode).toBe(503);
    expect(res.jsonData.error).toContain('not configured');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when API key is missing', () => {
    useKeys('valid-key-1,valid-key-2');
    const req = mockReq({});
    const res = mockRes();
    const next = mockNext;

    requireApiKey(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when API key is invalid', () => {
    useKeys('valid-key-1,valid-key-2');
    const req = mockReq({ 'x-api-key': 'wrong-key' });
    const res = mockRes();
    const next = mockNext;

    requireApiKey(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when API key is valid', () => {
    useKeys('valid-key-1,valid-key-2');
    const req = mockReq({ 'x-api-key': 'valid-key-1' });
    const res = mockRes();
    const next = mockNext;

    requireApiKey(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('accepts the second valid key from a comma-separated list', () => {
    useKeys('key-one,key-two,key-three');
    const req = mockReq({ 'x-api-key': 'key-two' });
    const res = mockRes();
    const next = mockNext;

    requireApiKey(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('trims whitespace from valid keys', () => {
    useKeys('  key-with-spaces  , another-key ');
    const req = mockReq({ 'x-api-key': 'key-with-spaces' });
    const res = mockRes();
    const next = mockNext;

    requireApiKey(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 401 when API key is an empty string', () => {
    useKeys('valid-key');
    const req = mockReq({ 'x-api-key': '' });
    const res = mockRes();
    const next = mockNext;

    requireApiKey(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
