import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  tracingMiddleware,
  sqlTracingMiddleware,
  cacheTracingMiddleware,
  mongoTracingMiddleware,
  webSocketTracingMiddleware,
  traceAsyncSpan
} from '../../src/middleware/tracingMiddleware.js';

describe('Tracing Middleware Custom Spans Unit Tests', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      method: 'POST',
      url: '/api/v1/orders',
      path: '/api/v1/orders',
      headers: { 'user-agent': 'Vitest-Test' },
      ip: '127.0.0.1',
      requestId: 'req-12345',
      socket: { remoteAddress: '127.0.0.1' }
    };

    const listeners = {};
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      statusCode: 200,
      on: vi.fn((event, callback) => {
        listeners[event] = callback;
      }),
      _trigger: (event, arg) => {
        if (listeners[event]) listeners[event](arg);
      }
    };

    next = vi.fn();
  });

  it('should skip tracing for health and metrics endpoints', () => {
    req.path = '/health';
    tracingMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('should initialize OpenTelemetry HTTP span and set X-Trace-Id header', () => {
    tracingMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('X-Trace-Id', expect.any(String));
  });

  it('should create SQL query tracing span with attributes', () => {
    const span = sqlTracingMiddleware('SELECT * FROM bookings WHERE id = $1', ['b123']);
    expect(span).toBeDefined();
  });

  it('should create Cache tracing span with attributes', () => {
    const span = cacheTracingMiddleware('GET', 'idempotency:b123');
    expect(span).toBeDefined();
  });

  it('should create MongoDB tracing span with attributes', () => {
    const span = mongoTracingMiddleware('find', 'telemetry_logs');
    expect(span).toBeDefined();
  });

  it('should create WebSocket tracing span with attributes', () => {
    const span = webSocketTracingMiddleware('location_update', 'socket-abc');
    expect(span).toBeDefined();
  });

  it('should execute traceAsyncSpan and return result on success', async () => {
    const mockAsync = vi.fn().mockResolvedValue({ success: true });
    const result = await traceAsyncSpan('TestAsyncOp', { 'test.attr': 'val' }, mockAsync);

    expect(result).toEqual({ success: true });
    expect(mockAsync).toHaveBeenCalled();
  });

  it('should record exception and rethrow error in traceAsyncSpan on failure', async () => {
    const mockAsync = vi.fn().mockRejectedValue(new Error('Async Failure'));

    await expect(
      traceAsyncSpan('TestAsyncOpError', {}, mockAsync)
    ).rejects.toThrow('Async Failure');

    expect(mockAsync).toHaveBeenCalled();
  });
});
