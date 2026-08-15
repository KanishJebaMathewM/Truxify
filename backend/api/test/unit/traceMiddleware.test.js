import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createWorkerContextFromRequest,
  propagateContextToBackground,
  restoreBackgroundContext,
} from '../../src/core/telemetry/TraceMiddleware.js';

const { mockReq, mockRes, mockNext, mockSpan } = vi.hoisted(() => {
  const mockSpan = {
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
    setAttributes: vi.fn(),
    spanContext: () => ({ traceId: 'mock-trace-id', spanId: 'mock-span-id' }),
  };
  const mockReq = {
    path: '/test',
    method: 'GET',
    url: '/test',
    headers: {},
    ip: '127.0.0.1',
    requestId: 'req-1',
    correlationId: 'corr-1',
  };
  const mockRes = {
    setHeader: vi.fn(),
    on: vi.fn(),
    statusCode: 200,
  };
  const mockNext = vi.fn();
  return { mockReq, mockRes, mockNext, mockSpan };
});

vi.mock('../../src/tracing/tracing.js', () => ({
  default: {
    initialize: vi.fn(),
    getTracer: vi.fn(() => ({
      startSpan: vi.fn(() => mockSpan),
    })),
  },
}));

vi.mock('../../src/core/telemetry/SpanFactory.js', () => ({
  default: {
    startSpan: vi.fn(() => mockSpan),
    startWorkerSpan: vi.fn(() => mockSpan),
    recordError: vi.fn(),
  },
  STANDARD_ATTRIBUTES: {},
}));

describe('TraceMiddleware utilities', () => {
  describe('createWorkerContextFromRequest', () => {
    it('returns empty object when req is undefined', () => {
      expect(createWorkerContextFromRequest(undefined)).toEqual({});
    });

    it('returns empty object when req is null', () => {
      expect(createWorkerContextFromRequest(null)).toEqual({});
    });

    it('returns empty object when req has no _traceSnapshot', () => {
      expect(createWorkerContextFromRequest({})).toEqual({});
    });

    it('returns traceSnapshot when available', () => {
      const snapshot = { traceId: 'abc123' };
      const result = createWorkerContextFromRequest({ _traceSnapshot: snapshot });
      expect(result).toEqual({ traceSnapshot: snapshot });
    });
  });

  describe('propagateContextToBackground', () => {
    it('returns null when req is undefined', () => {
      expect(propagateContextToBackground(undefined)).toBeNull();
    });

    it('returns null when req has no _traceSnapshot', () => {
      expect(propagateContextToBackground({})).toBeNull();
    });

    it('returns trace context data with default source', () => {
      const req = {
        _traceSnapshot: { traceId: 'abc' },
        correlationId: 'corr-1',
        traceId: 'trace-abc',
      };
      const result = propagateContextToBackground(req);
      expect(result.traceSnapshot).toEqual({ traceId: 'abc' });
      expect(result.correlationId).toBe('corr-1');
      expect(result.traceId).toBe('trace-abc');
      expect(result.source).toBe('http-request');
    });

    it('uses custom source when provided', () => {
      const req = { _traceSnapshot: {}, traceId: 'x' };
      const result = propagateContextToBackground(req, { source: 'custom-source' });
      expect(result.source).toBe('custom-source');
    });
  });

  describe('restoreBackgroundContext', () => {
    it('runs fn when contextData has no traceSnapshot', async () => {
      const fn = vi.fn(() => Promise.resolve('result'));
      const result = await restoreBackgroundContext({}, fn);
      expect(fn).toHaveBeenCalled();
      expect(result).toBe('result');
    });

    it('runs fn when contextData is null', async () => {
      const fn = vi.fn(() => Promise.resolve('done'));
      const result = await restoreBackgroundContext(null, fn);
      expect(fn).toHaveBeenCalled();
      expect(result).toBe('done');
    });

    it('runs fn and returns its result when contextData is valid', async () => {
      const fn = vi.fn(() => Promise.resolve('bg-result'));
      const contextData = {
        traceSnapshot: { traceId: 'bg-trace' },
        correlationId: 'bg-corr',
        traceId: 'bg-tid',
        source: 'background',
      };
      const result = await restoreBackgroundContext(contextData, fn);
      expect(fn).toHaveBeenCalled();
      expect(result).toBe('bg-result');
    });

    it('runs fn synchronously when traceSnapshot is missing', async () => {
      const fn = vi.fn(() => 'sync-result');
      const result = restoreBackgroundContext({ source: 'x' }, fn);
      expect(fn).toHaveBeenCalled();
      expect(result).toBe('sync-result');
    });
  });

  it('finish callback sets span status to OK on 2xx', async () => {
    const { enhancedTracingMiddleware: fn } = await import(
      '../../src/core/telemetry/TraceMiddleware.js'
    );
    mockRes.statusCode = 200;
    fn(mockReq, mockRes, mockNext);
    const finishCb = mockRes.on.mock.calls.find((c) => c[0] === 'finish')[1];
    finishCb();
    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
  });

  it('records error on response error event', async () => {
    const { enhancedTracingMiddleware: fn } = await import(
      '../../src/core/telemetry/TraceMiddleware.js'
    );
    const spanFactory = (await import('../../src/core/telemetry/SpanFactory.js')).default;
    fn(mockReq, mockRes, mockNext);
    const errorCb = mockRes.on.mock.calls.find((c) => c[0] === 'error')[1];
    const testError = new Error('connection reset');
    errorCb(testError);
    expect(spanFactory.recordError).toHaveBeenCalledWith(mockSpan, testError);
  });

  it('ends span on finish', async () => {
    const { enhancedTracingMiddleware: fn } = await import(
      '../../src/core/telemetry/TraceMiddleware.js'
    );
    fn(mockReq, mockRes, mockNext);
    const finishCb = mockRes.on.mock.calls.find((c) => c[0] === 'finish')[1];
    finishCb();
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('sets http.response_time_ms attribute on finish', async () => {
    const { enhancedTracingMiddleware: fn } = await import(
      '../../src/core/telemetry/TraceMiddleware.js'
    );
    fn(mockReq, mockRes, mockNext);
    const finishCb = mockRes.on.mock.calls.find((c) => c[0] === 'finish')[1];
    finishCb();
    expect(mockSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'http.status_code': 200,
        'http.response_time_ms': expect.any(Number),
      }),
    );
  });
});

describe('TraceMiddleware — createWorkerContextFromRequest', () => {
  it('returns empty object when req._traceSnapshot is missing', async () => {
    const { createWorkerContextFromRequest } = await import(
      '../../src/core/telemetry/TraceMiddleware.js'
    );
    const result = createWorkerContextFromRequest({});
    expect(result).toEqual({});
  });

  it('returns traceSnapshot when req._traceSnapshot is present', async () => {
    const { createWorkerContextFromRequest } = await import(
      '../../src/core/telemetry/TraceMiddleware.js'
    );
    const snapshot = { traceparent: '00-abc-def' };
    const result = createWorkerContextFromRequest({ _traceSnapshot: snapshot });
    expect(result).toEqual({ traceSnapshot: snapshot });
  });
});

describe('TraceMiddleware — propagateContextToBackground', () => {
  it('returns null when req._traceSnapshot is missing', async () => {
    const { propagateContextToBackground } = await import(
      '../../src/core/telemetry/TraceMiddleware.js'
    );
    const result = propagateContextToBackground({});
    expect(result).toBeNull();
  });

  it('returns context object with traceSnapshot and correlationId', async () => {
    const { propagateContextToBackground } = await import(
      '../../src/core/telemetry/TraceMiddleware.js'
    );
    const snapshot = { traceparent: '00-abc-def' };
    const req = {
      _traceSnapshot: snapshot,
      correlationId: 'corr-123',
      traceId: 'trace-abc',
    };
    const result = propagateContextToBackground(req, { source: 'test-source' });
    expect(result.traceSnapshot).toBe(snapshot);
    expect(result.correlationId).toBe('corr-123');
    expect(result.traceId).toBe('trace-abc');
    expect(result.source).toBe('test-source');
  });

  it('uses default source when not provided', async () => {
    const { propagateContextToBackground } = await import(
      '../../src/core/telemetry/TraceMiddleware.js'
    );
    const req = { _traceSnapshot: {}, traceId: 'trace-abc' };
    const result = propagateContextToBackground(req);
    expect(result.source).toBe('http-request');
  });
});

describe('TraceMiddleware — restoreBackgroundContext', () => {
  it('runs fn immediately when contextData.traceSnapshot is missing', async () => {
    const { restoreBackgroundContext } = await import(
      '../../src/core/telemetry/TraceMiddleware.js'
    );
    const fn = vi.fn(() => 'result');
    const result = restoreBackgroundContext({}, fn);
    expect(fn).toHaveBeenCalled();
    expect(result).toBe('result');
  });
});
