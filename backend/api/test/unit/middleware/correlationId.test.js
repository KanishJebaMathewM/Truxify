import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { correlationIdMiddleware } from '../../../src/middleware/correlationId.js';

const mockReq = (headers = {}) => ({
  headers,
  correlationId: null,
  requestId: null,
  id: null,
});

const mockRes = () => {
  const res = {
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
  };
  return res;
};

describe('correlationIdMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates a new random UUID when no correlation ID is in headers', () => {
    const req = mockReq({});
    const res = mockRes();
    const next = vi.fn();

    correlationIdMiddleware(req, res, next);

    expect(req.correlationId).toBeTruthy();
    // UUID format check
    expect(req.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(next).toHaveBeenCalledOnce();
  });

  it('uses the x-correlation-id header when valid', () => {
    const req = mockReq({ 'x-correlation-id': 'my-correlation-123' });
    const res = mockRes();
    const next = vi.fn();

    correlationIdMiddleware(req, res, next);

    expect(req.correlationId).toBe('my-correlation-123');
    expect(next).toHaveBeenCalledOnce();
  });

  it('uses X-Correlation-ID header (capital variant)', () => {
    const req = mockReq({ 'X-Correlation-ID': 'capital-header-id' });
    const res = mockRes();
    const next = vi.fn();

    correlationIdMiddleware(req, res, next);

    expect(req.correlationId).toBe('capital-header-id');
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects correlation IDs longer than 64 characters', () => {
    const longId = 'a'.repeat(65);
    const req = mockReq({ 'x-correlation-id': longId });
    const res = mockRes();
    const next = vi.fn();

    correlationIdMiddleware(req, res, next);

    // Should fall back to randomUUID instead of accepting the long id
    expect(req.correlationId).not.toBe(longId);
    expect(req.correlationId).toMatch(/^[0-9a-f]{8}-/);
    expect(next).toHaveBeenCalledOnce();
  });

  it('sets X-Correlation-ID response header', () => {
    const req = mockReq({});
    const res = mockRes();
    const next = vi.fn();

    correlationIdMiddleware(req, res, next);

    expect(res.headers['X-Correlation-ID']).toBe(req.correlationId);
  });

  it('accepts correlation IDs with alphanumeric, underscore, and hyphen', () => {
    const validId = 'valid-id_123';
    const req = mockReq({ 'x-correlation-id': validId });
    const res = mockRes();
    const next = vi.fn();

    correlationIdMiddleware(req, res, next);

    expect(req.correlationId).toBe(validId);
    expect(next).toHaveBeenCalledOnce();
  });
});
