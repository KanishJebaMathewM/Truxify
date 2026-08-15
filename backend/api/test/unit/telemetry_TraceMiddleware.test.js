/**
 * Unit tests for backend/api/src/core/telemetry/TraceMiddleware.js
 *
 * Coverage:
 *   - constructor: initializes middleware
 *   - middleware: attaches trace context and calls next
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@opentelemetry/api', () => ({
  context: { active: vi.fn(() => ({ some: 'ctx' })) },
  trace: { getTracer: vi.fn(() => ({ startSpan: vi.fn(() => ({ setStatus: vi.fn(), end: vi.fn(), setAttributes: vi.fn(), setAttribute: vi.fn() })) })) },
  SpanStatusCode: { OK: 0, ERROR: 1 },
}));

const TraceMiddleware = (await import('../../src/core/telemetry/TraceMiddleware.js')).TraceMiddleware;

describe('TraceMiddleware', () => {
  let mw;

  beforeEach(() => { vi.clearAllMocks(); mw = new TraceMiddleware('http-service'); });

  describe('constructor', () => {
    it('creates middleware with service name', () => { expect(mw.serviceName).toBe('http-service'); });
  });

  describe('middleware', () => {
    it('attaches trace context to request', async () => {
      const req = {}; const next = vi.fn();
      await mw.middleware(req, {}, next);
      expect(req.traceContext).toBeTruthy();
    });

    it('calls next handler', async () => {
      const next = vi.fn();
      await mw.middleware({}, {}, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
