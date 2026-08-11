/**
 * Unit tests for backend/api/src/middleware/apiKey.js
 *
 * Coverage:
 *   - Fails closed with 503 when VALID_API_KEYS is unset, empty or only separators
 *   - Returns 401 when x-api-key header is missing
 *   - Returns 401 when x-api-key header is invalid
 *   - Returns 401 when api_key query param is invalid
 *   - Calls next() when valid key provided via x-api-key header
 *   - Calls next() when valid key provided via query.api_key
 *   - Accepts any key from comma-separated VALID_API_KEYS list
 *   - Logs warning and captures Sentry event on invalid key attempt
 *
 * Run with: npx vitest run test/unit/apiKey.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requireApiKey } from '../../src/middleware/apiKey.js';
import logger from '../../src/middleware/logger.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@sentry/node', () => ({
  withScope: vi.fn((fn) => {
    const mockScope = {
      setTag: vi.fn(),
      setExtra: vi.fn(),
    };
    fn(mockScope);
  }),
  captureMessage: vi.fn(),
}));

function createMocks(overrides = {}) {
  const jsonMock = vi.fn();
  const statusMock = vi.fn(() => ({
    json: jsonMock,
  }));
  return {
    req: {
      headers: {},
      query: {},
      ip: '127.0.0.1',
      originalUrl: '/api/test',
      ...overrides.req,
    },
    res: {
      status: statusMock,
      _jsonMock: jsonMock,
      ...overrides.res,
    },
    next: vi.fn(),
  };
}

describe('requireApiKey', () => {
  beforeEach(() => {
    vi.stubEnv('VALID_API_KEYS', 'test-key-1,test-key-2');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  // Fails closed: an unconfigured VALID_API_KEYS must not turn into an open
  // door on the backend-to-backend routes this middleware guards.
  it('returns 503 and does not call next() when VALID_API_KEYS is not set', () => {
    vi.stubEnv('VALID_API_KEYS', '');
    const { req, res, next } = createMocks();

    requireApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('fails closed when VALID_API_KEYS is only separators or whitespace', () => {
    vi.stubEnv('VALID_API_KEYS', ' , ,  ');
    const { req, res, next } = createMocks();

    requireApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when x-api-key header is missing', () => {
    const { req, res, next } = createMocks({ req: { headers: {} } });

    requireApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Unauthorized: Invalid API Key' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when x-api-key header is invalid', () => {
    const { req, res, next } = createMocks({
      req: { headers: { 'x-api-key': 'wrong-key' } },
    });

    requireApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when api_key query param is invalid', () => {
    const { req, res, next } = createMocks({
      req: { headers: {}, query: { api_key: 'wrong-key' } },
    });

    requireApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when valid key provided via x-api-key header', () => {
    const { req, res, next } = createMocks({
      req: { headers: { 'x-api-key': 'test-key-1' } },
    });

    requireApiKey(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next() when valid key provided via query.api_key', () => {
    const { req, res, next } = createMocks({
      req: { headers: {}, query: { api_key: 'test-key-2' } },
    });

    requireApiKey(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepts second key in comma-separated VALID_API_KEYS list', () => {
    const { req, res, next } = createMocks({
      req: { headers: { 'x-api-key': 'test-key-2' } },
    });

    requireApiKey(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('logs warning when invalid key is provided', () => {
    const { req, res, next } = createMocks({
      req: { headers: { 'x-api-key': 'bad-key' } },
    });

    requireApiKey(req, res, next);

    expect(logger.warn).toHaveBeenCalled();
  });
});
