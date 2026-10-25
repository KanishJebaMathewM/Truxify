import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '../../src/lib/logger.js';
import {
  correlationIdMiddleware,
  requestLoggingMiddleware,
  runWithCorrelationId,
  getCorrelationId,
  getFastApiHeaders,
} from '../../src/middleware/correlationId.js';
import axios from 'axios';

describe('Winston Structured Logger', () => {
  it('is a Winston logger instance with expected methods', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.fatal).toBe('function');
    expect(typeof logger.trace).toBe('function');
  });

  it('includes explicitly provided correlationId in log metadata', () => {
    let captured = null;
    const onData = (chunk) => {
      if (chunk.message === 'explicit correlation test') {
        captured = chunk;
      }
    };
    logger.on('data', onData);

    logger.info('explicit correlation test', { correlationId: 'test-explicit-123' });

    expect(captured).toBeDefined();
    expect(captured.message).toBe('explicit correlation test');
    expect(captured.correlationId).toBe('test-explicit-123');
    expect(captured.timestamp).toBeDefined();
    expect(captured.level).toBe('info');

    logger.off('data', onData);
  });

  it('automatically injects correlationId from AsyncLocalStorage context if not explicitly provided', () => {
    let captured = null;
    const onData = (chunk) => {
      if (chunk.message === 'context correlation test') {
        captured = chunk;
      }
    };
    logger.on('data', onData);

    runWithCorrelationId('auto-ctx-999', () => {
      logger.info('context correlation test');
    });

    expect(captured).toBeDefined();
    expect(captured.message).toBe('context correlation test');
    expect(captured.correlationId).toBe('auto-ctx-999');
    expect(captured.timestamp).toBeDefined();

    logger.off('data', onData);
  });
});

describe('Correlation ID Middleware', () => {
  it('forwards valid incoming X-Correlation-ID header', () => {
    const req = { headers: { 'x-correlation-id': 'client-corr-555' } };
    const res = { setHeader: vi.fn(), locals: {} };
    const next = vi.fn();

    correlationIdMiddleware(req, res, next);

    expect(req.correlationId).toBe('client-corr-555');
    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', 'client-corr-555');
    expect(res.locals.correlationId).toBe('client-corr-555');
    expect(next).toHaveBeenCalledOnce();
  });

  it('generates a new UUID when incoming header is missing', () => {
    const req = { headers: {} };
    const res = { setHeader: vi.fn(), locals: {} };
    const next = vi.fn();

    correlationIdMiddleware(req, res, next);

    expect(req.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', req.correlationId);
    expect(next).toHaveBeenCalledOnce();
  });

  it('runs the handler inside AsyncLocalStorage correlation context', () => {
    const req = { headers: { 'x-correlation-id': 'scoped-id-777' } };
    const res = { setHeader: vi.fn(), locals: {} };
    let capturedId = null;

    correlationIdMiddleware(req, res, () => {
      capturedId = getCorrelationId();
    });

    expect(capturedId).toBe('scoped-id-777');
  });
});

describe('Request/Response Logging Middleware', () => {
  it('logs method, path, status code, durationMs, and correlationId on finish', () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => logger);
    const finishCallbacks = [];
    const req = {
      method: 'POST',
      originalUrl: '/api/v1/orders',
      correlationId: 'req-logging-id-100',
    };
    const res = {
      statusCode: 201,
      on: vi.fn((event, cb) => {
        if (event === 'finish') finishCallbacks.push(cb);
      }),
    };
    const next = vi.fn();

    requestLoggingMiddleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();

    // Trigger finish
    finishCallbacks.forEach((cb) => cb());

    expect(infoSpy).toHaveBeenCalledWith(
      'Request completed',
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/orders',
        statusCode: 201,
        correlationId: 'req-logging-id-100',
        durationMs: expect.any(Number),
      })
    );

    infoSpy.mockRestore();
  });
});

describe('FastAPI Forwarding', () => {
  it('getFastApiHeaders returns headers with X-Correlation-ID from active context', () => {
    runWithCorrelationId('fastapi-ctx-123', () => {
      const headers = getFastApiHeaders({ 'X-Custom': 'val' });
      expect(headers['X-Correlation-ID']).toBe('fastapi-ctx-123');
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-Custom']).toBe('val');
    });
  });

  it('axios request interceptor automatically attaches X-Correlation-ID', async () => {
    const interceptor = axios.interceptors.request.handlers.find((h) => h && h.fulfilled);
    expect(interceptor).toBeDefined();

    runWithCorrelationId('axios-trace-456', () => {
      const config = { headers: {} };
      const modified = interceptor.fulfilled(config);
      expect(modified.headers['X-Correlation-ID']).toBe('axios-trace-456');
    });
  });
});
