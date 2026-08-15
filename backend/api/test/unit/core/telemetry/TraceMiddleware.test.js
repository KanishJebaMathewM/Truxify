import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the OpenTelemetry API
vi.mock('@opentelemetry/api', () => {
  const mockSpan = {
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn(),
    spanContext: vi.fn(() => ({ traceId: 'test-trace-id', spanId: 'test-span-id' })),
  };
  const mockTracer = {
    startSpan: vi.fn(() => mockSpan),
  };
  return {
    context: {
      active: vi.fn(() => 'mock-context'),
      with: vi.fn((ctx, fn) => fn()),
    },
    trace: {
      setSpan: vi.fn(),
      getTracer: vi.fn(() => mockTracer),
    },
    propagation: {
      extract: vi.fn(() => 'mock-propagation-context'),
    },
    SpanStatusCode: { OK: 0, ERROR: 2 },
  };
});

vi.mock('../../../../src/tracing/tracing.js', () => ({
  default: {
    getTracer: vi.fn(() => ({
      startSpan: vi.fn(() => ({
        setAttributes: vi.fn(),
        setStatus: vi.fn(),
        end: vi.fn(),
        spanContext: vi.fn(() => ({ traceId: 'test-trace', spanId: 'test-span' })),
      })),
    })),
  },
}));

vi.mock('../../../../src/core/telemetry/SpanFactory.js', () => ({
  default: {
    startWorkerSpan: vi.fn(() => ({
      setStatus: vi.fn(),
      end: vi.fn(),
    })),
    recordError: vi.fn(),
  },
  STANDARD_ATTRIBUTES: {},
}));

vi.mock('../../../../src/core/telemetry/ContextPropagator.js', () => ({
  ContextPropagator: {
    snapshot: vi.fn(() => ({ mock: 'snapshot' })),
    restore: vi.fn((snapshot, fn) => fn()),
  },
}));

const {
  enhancedTracingMiddleware,
  createWorkerContextFromRequest,
  propagateContextToBackground,
  restoreBackgroundContext,
} = await import('../../../../src/core/telemetry/TraceMiddleware.js');

describe('TraceMiddleware', () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    mockReq = {
      path: '/api/test',
      method: 'GET',
      url: '/api/test',
      headers: { 'user-agent': 'test-agent' },
      ip: '127.0.0.1',
      requestId: 'req-123',
      correlationId: 'corr-456',
    };
    mockRes = {
      statusCode: 200,
      setHeader: vi.fn(),
      on: vi.fn((event, cb) => {
        if (event === 'finish') mockRes._finishCb = cb;
        if (event === 'error') mockRes._errorCb = cb;
      }),
    };
    mockNext = vi.fn();
  });

  describe('enhancedTracingMiddleware', () => {
    it('skips health endpoint', () => {
      mockReq.path = '/health';
      enhancedTracingMiddleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('skips metrics endpoint', () => {
      mockReq.path = '/metrics';
      enhancedTracingMiddleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('skips favicon', () => {
      mockReq.path = '/favicon.ico';
      enhancedTracingMiddleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('calls next() for normal paths', () => {
      mockReq.path = '/api/orders';
      enhancedTracingMiddleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('sets X-Trace-Id header on response', () => {
      mockReq.path = '/api/test';
      enhancedTracingMiddleware(mockReq, mockRes, mockNext);
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Trace-Id', 'test-trace');
    });

    it('attaches span and trace info to request', () => {
      mockReq.path = '/api/test';
      enhancedTracingMiddleware(mockReq, mockRes, mockNext);
      expect(mockReq.traceId).toBe('test-trace');
      expect(mockReq.spanId).toBe('test-span');
    });
  });

  describe('createWorkerContextFromRequest', () => {
    it('returns empty object when req is falsy', () => {
      expect(createWorkerContextFromRequest(null)).toEqual({});
      expect(createWorkerContextFromRequest(undefined)).toEqual({});
    });

    it('returns empty object when _traceSnapshot is missing', () => {
      expect(createWorkerContextFromRequest({})).toEqual({});
      expect(createWorkerContextFromRequest({ _traceSnapshot: undefined })).toEqual({});
    });

    it('returns traceSnapshot when present', () => {
      const req = { _traceSnapshot: { mock: 'snapshot-data' } };
      expect(createWorkerContextFromRequest(req)).toEqual({ traceSnapshot: { mock: 'snapshot-data' } });
    });
  });

  describe('propagateContextToBackground', () => {
    it('returns null when req is falsy', () => {
      expect(propagateContextToBackground(null)).toBeNull();
      expect(propagateContextToBackground(undefined)).toBeNull();
    });

    it('returns null when _traceSnapshot is missing', () => {
      expect(propagateContextToBackground({})).toBeNull();
    });

    it('returns context object with snapshot', () => {
      const req = {
        _traceSnapshot: { mock: 'snapshot' },
        correlationId: 'corr-123',
        traceId: 'trace-abc',
      };
      const result = propagateContextToBackground(req);
      expect(result.traceSnapshot).toEqual({ mock: 'snapshot' });
      expect(result.correlationId).toBe('corr-123');
      expect(result.traceId).toBe('trace-abc');
      expect(result.source).toBe('http-request');
    });

    it('uses custom source option', () => {
      const req = { _traceSnapshot: { mock: 'snapshot' } };
      const result = propagateContextToBackground(req, { source: 'custom-source' });
      expect(result.source).toBe('custom-source');
    });
  });

  describe('restoreBackgroundContext', () => {
    it('calls fn immediately when traceSnapshot is missing', async () => {
      const fn = vi.fn(() => Promise.resolve('result'));
      await restoreBackgroundContext({}, fn);
      expect(fn).toHaveBeenCalled();
    });

    it('calls fn immediately when contextData is null', async () => {
      const fn = vi.fn(() => Promise.resolve('result'));
      await restoreBackgroundContext(null, fn);
      expect(fn).toHaveBeenCalled();
    });

    it('restores context and calls fn when snapshot is present', async () => {
      const fn = vi.fn(() => Promise.resolve('done'));
      const ctx = { traceSnapshot: { mock: 'data' }, source: 'test-worker', correlationId: 'c1', traceId: 't1' };
      await restoreBackgroundContext(ctx, fn);
      expect(fn).toHaveBeenCalled();
    });
  });
});
