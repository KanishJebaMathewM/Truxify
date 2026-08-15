import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireApiKey, AuthConfig } from '../../../src/middleware/apiKey.js';

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
    process.env.VALID_API_KEYS = 'valid-key-1,valid-key-2';
    const req = mockReq({});
    const res = mockRes();
    const next = mockNext;

    requireApiKey(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when API key is invalid', () => {
    process.env.VALID_API_KEYS = 'valid-key-1,valid-key-2';
    const req = mockReq({ 'x-api-key': 'wrong-key' });
    const res = mockRes();
    const next = mockNext;

    requireApiKey(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when API key is valid', () => {
    process.env.VALID_API_KEYS = 'valid-key-1,valid-key-2';
    const req = mockReq({ 'x-api-key': 'valid-key-1' });
    const res = mockRes();
    const next = mockNext;

    requireApiKey(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('accepts the second valid key from a comma-separated list', () => {
    process.env.VALID_API_KEYS = 'key-one,key-two,key-three';
    const req = mockReq({ 'x-api-key': 'key-two' });
    const res = mockRes();
    const next = mockNext;

    requireApiKey(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('trims whitespace from valid keys', () => {
    process.env.VALID_API_KEYS = '  key-with-spaces  , another-key ';
    const req = mockReq({ 'x-api-key': 'key-with-spaces' });
    const res = mockRes();
    const next = mockNext;

    requireApiKey(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 401 when API key is an empty string', () => {
    process.env.VALID_API_KEYS = 'valid-key';
    const req = mockReq({ 'x-api-key': '' });
    const res = mockRes();
    const next = mockNext;

    requireApiKey(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('AuthConfig env parsing', () => {
  it('falls back to defaults when env values are malformed', () => {
    process.env.SIGNATURE_MAX_AGE_MS = 'abc';
    process.env.RATE_LIMIT_WINDOW_MS = 'not-a-number';
    process.env.RATE_LIMIT_MAX_REQUESTS = '';
    process.env.KEY_CACHE_TTL_MS = '0';
    try {
      const config = new AuthConfig();
      expect(config.signatureMaxAgeMs).toBe(300000);
      expect(config.defaultRateLimitWindowMs).toBe(60000);
      expect(config.defaultRateLimitMax).toBe(100);
      expect(config.cacheTtlMs).toBe(600000);
    } finally {
      delete process.env.SIGNATURE_MAX_AGE_MS;
      delete process.env.RATE_LIMIT_WINDOW_MS;
      delete process.env.RATE_LIMIT_MAX_REQUESTS;
      delete process.env.KEY_CACHE_TTL_MS;
    }
  });

  it('uses valid env values without coercion', () => {
    process.env.SIGNATURE_MAX_AGE_MS = '5000';
    try {
      const config = new AuthConfig();
      expect(config.signatureMaxAgeMs).toBe(5000);
    } finally {
      delete process.env.SIGNATURE_MAX_AGE_MS;
    }
  });
});
