import { describe, it, expect, vi, beforeEach } from 'vitest';
import spanFactory, { STANDARD_ATTRIBUTES } from '../../src/core/telemetry/SpanFactory.js';
import { SPAN_NAMES } from '../../src/core/telemetry/SpanFactory.js';

describe('SpanFactory', () => {
  describe('SPAN_NAMES', () => {
    it('contains expected span name constants', () => {
      expect(SPAN_NAMES.WORKER_EXECUTION).toBe('worker.execution');
      expect(SPAN_NAMES.EVENT_PUBLISH).toBe('event.publish');
      expect(SPAN_NAMES.EVENT_SUBSCRIBE).toBe('event.subscribe');
      expect(SPAN_NAMES.HTTP_OUTGOING).toBe('http.outgoing');
    });
  });

  describe('STANDARD_ATTRIBUTES', () => {
    it('contains expected attribute constants', () => {
      expect(STANDARD_ATTRIBUTES.SERVICE_NAME).toBe('service.name');
      expect(STANDARD_ATTRIBUTES.EVENT_TYPE).toBe('event.type');
      expect(STANDARD_ATTRIBUTES.CORRELATION_ID).toBe('correlation.id');
    });
  });
});
