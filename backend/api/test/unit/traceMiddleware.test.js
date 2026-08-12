import { describe, it, expect } from 'vitest';
import {
  createWorkerContextFromRequest,
  propagateContextToBackground,
} from '../../src/core/telemetry/TraceMiddleware.js';

describe('TraceMiddleware context helpers', () => {
  describe('createWorkerContextFromRequest', () => {
    it('returns an empty object without a trace snapshot', () => {
      expect(createWorkerContextFromRequest({})).toEqual({});
      expect(createWorkerContextFromRequest(null)).toEqual({});
    });

    it('extracts the trace snapshot', () => {
      const req = { _traceSnapshot: { traceparent: '00-abc-123-01' } };
      expect(createWorkerContextFromRequest(req)).toEqual({
        traceSnapshot: { traceparent: '00-abc-123-01' },
      });
    });
  });

  describe('propagateContextToBackground', () => {
    it('returns null without a trace snapshot', () => {
      expect(propagateContextToBackground({})).toBeNull();
      expect(propagateContextToBackground(null)).toBeNull();
    });

    it('returns context data with snapshot and ids', () => {
      const req = {
        _traceSnapshot: { traceparent: '00-abc-123-01' },
        correlationId: 'corr-1',
        traceId: 'trace-1',
      };
      const result = propagateContextToBackground(req, { source: 'worker' });
      expect(result).toEqual({
        traceSnapshot: { traceparent: '00-abc-123-01' },
        correlationId: 'corr-1',
        traceId: 'trace-1',
        source: 'worker',
      });
    });

    it('defaults source to http-request', () => {
      const req = {
        _traceSnapshot: { traceparent: '00-abc-123-01' },
        traceId: 'trace-1',
      };
      const result = propagateContextToBackground(req);
      expect(result.source).toBe('http-request');
    });
  });
});
