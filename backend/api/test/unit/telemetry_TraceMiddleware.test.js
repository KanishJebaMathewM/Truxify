/**
 * Unit tests for backend/api/src/core/telemetry/TraceMiddleware.js
 *
 * The module exports functions (no TraceMiddleware class):
 *   - enhancedTracingMiddleware: HTTP span per request, X-Trace-Id header,
 *     status-dependent span status on finish, skipped for /health,/metrics,/favicon.ico
 *   - createWorkerContextFromRequest / propagateContextToBackground
 *   - restoreBackgroundContext: runs fn in a worker span under the restored snapshot
 */
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const makeSpan = () => ({
  setStatus: vi.fn(),
  end: vi.fn(),
  setAttributes: vi.fn(),
  setAttribute: vi.fn(),
  spanContext: vi.fn(() => ({ traceId: 'trace-1', spanId: 'span-1' })),
});

const { tracerMock, spanFactoryMock, propagatorMock } = vi.hoisted(() => ({
  tracerMock: { startSpan: vi.fn() },
  spanFactoryMock: { recordError: vi.fn(), startWorkerSpan: vi.fn() },
  propagatorMock: {
    snapshot: vi.fn(() => ({ snap: true })),
    restore: vi.fn((_snapshot, fn) => fn()),
  },
}));

vi.mock('@opentelemetry/api', () => ({
  context: { active: vi.fn(() => ({})), with: vi.fn((_ctx, fn) => fn()) },
  trace: { setSpan: vi.fn(() => ({})) },
  SpanStatusCode: { OK: 1, ERROR: 2 },
}));
vi.mock('../../src/tracing/tracing.js', () => ({ default: { getTracer: () => tracerMock } }));
vi.mock('../../src/core/telemetry/SpanFactory.js', () => ({ default: spanFactoryMock, STANDARD_ATTRIBUTES: {} }));
vi.mock('../../src/core/telemetry/ContextPropagator.js', () => ({ ContextPropagator: propagatorMock }));
vi.mock('../../src/core/telemetry/TraceContext.js', () => ({ TraceContext: {} }));

const {
  enhancedTracingMiddleware,
  createWorkerContextFromRequest,
  propagateContextToBackground,
  restoreBackgroundContext,
} = await import('../../src/core/telemetry/TraceMiddleware.js');

const makeReq = (overrides = {}) => ({
  method: 'GET',
  path: '/api/orders',
  url: '/api/orders?page=1',
  headers: { 'user-agent': 'vitest' },
  ip: '10.0.0.1',
  requestId: 'req-1',
  correlationId: 'corr-1',
  ...overrides,
});

const makeRes = () => Object.assign(new EventEmitter(), { statusCode: 200, setHeader: vi.fn() });

describe('TraceMiddleware', () => {
  let span;

  beforeEach(() => {
    vi.clearAllMocks();
    span = makeSpan();
    tracerMock.startSpan.mockReturnValue(span);
    spanFactoryMock.startWorkerSpan.mockReturnValue(span);
  });

  describe('enhancedTracingMiddleware', () => {
    it.each(['/health', '/metrics', '/favicon.ico'])('skips tracing for %s', (path) => {
      const next = vi.fn();
      enhancedTracingMiddleware(makeReq({ path }), makeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(tracerMock.startSpan).not.toHaveBeenCalled();
    });

    it('starts an HTTP span, attaches trace context and sets X-Trace-Id before calling next', () => {
      const req = makeReq();
      const res = makeRes();
      const next = vi.fn();

      enhancedTracingMiddleware(req, res, next);

      expect(tracerMock.startSpan).toHaveBeenCalledWith('HTTP GET /api/orders', {
        attributes: {
          'http.method': 'GET',
          'http.url': '/api/orders?page=1',
          'http.path': '/api/orders',
          'http.user_agent': 'vitest',
          'http.client_ip': '10.0.0.1',
          'request.id': 'req-1',
          'correlation.id': 'corr-1',
        },
      });
      expect(req.span).toBe(span);
      expect(req.traceContext).toEqual({ traceId: 'trace-1', spanId: 'span-1', snapshot: { snap: true } });
      expect(res.setHeader).toHaveBeenCalledWith('X-Trace-Id', 'trace-1');
      expect(next).toHaveBeenCalledTimes(1);
      expect(span.end).not.toHaveBeenCalled();
    });

    it('ends the span OK with status code and timing on a successful finish', () => {
      const res = makeRes();
      enhancedTracingMiddleware(makeReq(), res, vi.fn());

      res.emit('finish');

      expect(span.setAttributes).toHaveBeenCalledWith({
        'http.status_code': 200,
        'http.response_time_ms': expect.any(Number),
      });
      expect(span.setStatus).toHaveBeenCalledWith({ code: 1 });
      expect(span.end).toHaveBeenCalledTimes(1);
    });

    it('marks the span as an error for 4xx/5xx responses', () => {
      const res = makeRes();
      enhancedTracingMiddleware(makeReq(), res, vi.fn());

      res.statusCode = 503;
      res.emit('finish');

      expect(span.setStatus).toHaveBeenCalledWith({ code: 2, message: 'HTTP 503' });
      expect(span.end).toHaveBeenCalledTimes(1);
    });

    it('records response stream errors on the span', () => {
      const res = makeRes();
      enhancedTracingMiddleware(makeReq(), res, vi.fn());

      const err = new Error('socket hang up');
      res.emit('error', err);

      expect(spanFactoryMock.recordError).toHaveBeenCalledWith(span, err);
      expect(span.end).toHaveBeenCalledTimes(1);
    });
  });

  describe('background context helpers', () => {
    it('createWorkerContextFromRequest returns the snapshot, or {} without one', () => {
      expect(createWorkerContextFromRequest({ _traceSnapshot: { s: 1 } })).toEqual({ traceSnapshot: { s: 1 } });
      expect(createWorkerContextFromRequest({})).toEqual({});
      expect(createWorkerContextFromRequest(undefined)).toEqual({});
    });

    it('propagateContextToBackground carries snapshot, correlation and trace ids', () => {
      const req = { _traceSnapshot: { s: 1 }, correlationId: 'c', traceId: 't' };
      expect(propagateContextToBackground(req, { source: 'email-job' })).toEqual({
        traceSnapshot: { s: 1 },
        correlationId: 'c',
        traceId: 't',
        source: 'email-job',
      });
      expect(propagateContextToBackground(req).source).toBe('http-request');
      expect(propagateContextToBackground({})).toBeNull();
    });

    it('restoreBackgroundContext runs fn directly when there is no snapshot', async () => {
      const fn = vi.fn(() => 'direct');
      expect(restoreBackgroundContext({}, fn)).toBe('direct');
      expect(propagatorMock.restore).not.toHaveBeenCalled();
    });

    it('restoreBackgroundContext runs fn in a worker span under the restored snapshot', async () => {
      const data = { traceSnapshot: { s: 1 }, correlationId: 'c', traceId: 't', source: 'email-job' };

      await expect(restoreBackgroundContext(data, async () => 'ran')).resolves.toBe('ran');
      expect(propagatorMock.restore).toHaveBeenCalledWith({ s: 1 }, expect.any(Function));
      expect(spanFactoryMock.startWorkerSpan).toHaveBeenCalledWith('email-job', {
        attributes: { 'correlation.id': 'c', 'parent.trace_id': 't' },
      });
      expect(span.setStatus).toHaveBeenCalledWith({ code: 1 });
      expect(span.end).toHaveBeenCalledTimes(1);
    });

    it('restoreBackgroundContext records the error and rethrows', async () => {
      const boom = new Error('job failed');
      await expect(restoreBackgroundContext({ traceSnapshot: {} }, async () => { throw boom; })).rejects.toThrow(boom);
      expect(spanFactoryMock.startWorkerSpan).toHaveBeenCalledWith('background-task', expect.any(Object));
      expect(spanFactoryMock.recordError).toHaveBeenCalledWith(span, boom);
      expect(span.end).toHaveBeenCalledTimes(1);
    });
  });
});
