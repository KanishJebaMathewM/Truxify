import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

import { requestContext } from '../../src/middleware/requestContext.js';

function makeRequest(overrides = {}) {
  return {
    headers: {},
    ...overrides,
  };
}

describe('requestContext middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps a valid session id from the request header', () => {
    const req = makeRequest({ headers: { 'x-session-id': 'session-header' } });
    const next = vi.fn();

    requestContext(req, {}, next);

    expect(req.sessionId).toBe('session-header');
    expect(req.context).toEqual({ sessionId: 'session-header' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockLogger.debug).not.toHaveBeenCalled();
  });

  it('falls back to req.sessionId when the header is absent', () => {
    const req = makeRequest({ sessionId: 'session-property' });

    requestContext(req, {}, vi.fn());

    expect(req.sessionId).toBe('session-property');
    expect(req.context.sessionId).toBe('session-property');
  });

  it('falls back to req.session.id when earlier sources are absent', () => {
    const req = makeRequest({ session: { id: 'session-object' } });

    requestContext(req, {}, vi.fn());

    expect(req.sessionId).toBe('session-object');
    expect(req.context.sessionId).toBe('session-object');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['non-string', 42],
    ['object', {}],
  ])('generates a fallback id for a %s session id', (_label, value) => {
    const req = makeRequest({ sessionId: value });
    const next = vi.fn();

    requestContext(req, {}, next);

    expect(req.sessionId).toMatch(/^fallback-[0-9a-f-]{36}$/);
    expect(req.context.sessionId).toBe(req.sessionId);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockLogger.debug).toHaveBeenCalledTimes(1);
  });

  it('preserves existing request context fields', () => {
    const req = makeRequest({
      headers: { 'x-session-id': 'session-preserved' },
      context: { traceId: 'trace-123', tenantId: 'tenant-9' },
    });

    requestContext(req, {}, vi.fn());

    expect(req.context).toEqual({
      traceId: 'trace-123',
      tenantId: 'tenant-9',
      sessionId: 'session-preserved',
    });
  });

  it('does not log a fallback when the header is valid', () => {
    const req = makeRequest({ headers: { 'x-session-id': 'session-clean' } });

    requestContext(req, {}, vi.fn());

    expect(mockLogger.debug).not.toHaveBeenCalled();
  });
});
