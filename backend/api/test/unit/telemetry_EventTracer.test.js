/**
 * Unit tests for backend/api/src/core/telemetry/EventTracer.js
 *
 * Coverage:
 *   - constructor: initializes tracer
 *   - startTrace: creates trace span
 *   - endTrace: closes span
 *   - getTrace: retrieves active trace
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStartSpan = vi.fn(() => ({ setStatus: vi.fn(), end: vi.fn(), setAttributes: vi.fn(), setAttribute: vi.fn() }));
vi.mock('@opentelemetry/api', () => ({ context: { active: vi.fn(() => ({})) }, trace: { getTracer: vi.fn(() => ({ startSpan: mockStartSpan })) }, SpanStatusCode: { OK: 0, ERROR: 1 } }));

const EventTracer = (await import('../../src/core/telemetry/EventTracer.js')).EventTracer;

describe('EventTracer', () => {
  beforeEach(() => { vi.clearAllMocks(); mockStartSpan.mockReturnValue({ setStatus: vi.fn(), end: vi.fn(), setAttributes: vi.fn(), setAttribute: vi.fn() }); });

  describe('constructor', () => {
    it('creates tracer instance', () => { expect(new EventTracer('test-service')).toBeTruthy(); });
  });

  describe('startTrace', () => {
    it('starts a trace span', () => {
      new EventTracer('test-service').startTrace('test-span', { attr: 'value' });
      expect(mockStartSpan).toHaveBeenCalledWith('test-span', expect.anything());
    });
  });

  describe('endTrace', () => {
    it('ends a trace span', () => {
      const tracer = new EventTracer('test-service');
      const span = tracer.startTrace('test-span');
      tracer.endTrace(span);
      expect(span.end).toHaveBeenCalled();
    });
  });

  describe('getTrace', () => {
    it('returns tracer instance', () => { expect(new EventTracer('test-service').getTrace()).toBeTruthy(); });
  });
});
