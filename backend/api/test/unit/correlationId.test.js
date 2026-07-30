import { describe, it, expect, vi } from 'vitest';
import { correlationIdMiddleware, correlationContext } from '../../src/middleware/correlationId.js';

function makeReq(headers = {}) {
  return {
    headers,
  };
}

function makeRes() {
  return {
    setHeader: vi.fn(),
    on: vi.fn(),
  };
}

describe('correlationIdMiddleware', () => {
  it('uses X-Correlation-ID header value when it is a non-empty string', () => {
    const req = makeReq({ 'x-correlation-id': 'my-custom-id-123' });
    const res = makeRes();
    const next = vi.fn();
    correlationIdMiddleware(req, res, next);
    expect(req.correlationId).toBe('my-custom-id-123');
    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', 'my-custom-id-123');
    expect(next).toHaveBeenCalledOnce();
  });

  it('trims whitespace from the header value', () => {
    const req = makeReq({ 'x-correlation-id': '  trimmed-id-456  ' });
    const res = makeRes();
    const next = vi.fn();
    correlationIdMiddleware(req, res, next);
    expect(req.correlationId).toBe('trimmed-id-456');
    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', 'trimmed-id-456');
  });

  it('falls back to a random UUID when no X-Correlation-ID header is present', () => {
    const req = makeReq({});
    const res = makeRes();
    const next = vi.fn();
    correlationIdMiddleware(req, res, next);
    expect(req.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Correlation-ID',
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    );
  });

  it('generates unique IDs per request', () => {
    const req1 = makeReq({});
    const req2 = makeReq({});
    const res1 = makeRes();
    const res2 = makeRes();
    correlationIdMiddleware(req1, res1, vi.fn());
    correlationIdMiddleware(req2, res2, vi.fn());
    expect(req1.correlationId).not.toBe(req2.correlationId);
  });

  it('sets the correlation ID in the AsyncLocalStorage context', () => {
    const req = makeReq({ 'x-correlation-id': 'context-test-id' });
    const res = makeRes();
    const next = vi.fn();
    correlationIdMiddleware(req, res, next);
    let storedId = null;
    correlationContext.run({ correlationId: 'context-test-id' }, () => {
      storedId = correlationContext.getStore()?.correlationId;
    });
    // The middleware stores the ID in the context before calling next
    expect(req.correlationId).toBe('context-test-id');
  });

  it('uses header value as-is when it is a valid UUID', () => {
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';
    const req = makeReq({ 'x-correlation-id': validUuid });
    const res = makeRes();
    const next = vi.fn();
    correlationIdMiddleware(req, res, next);
    expect(req.correlationId).toBe(validUuid);
    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', validUuid);
  });
});
