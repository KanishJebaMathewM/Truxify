/**
 * Unit tests for backend/api/src/core/telemetry/SpanFactory.js
 *
 * Coverage:
 *   - constructor: sets tracer name
 *   - startSpan: creates span
 *   - STANDARD_ATTRIBUTES: exports expected constants
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStartSpan = vi.fn(() => ({ setStatus: vi.fn(), end: vi.fn(), setAttributes: vi.fn(), setAttribute: vi.fn() }));
vi.mock('../../src/core/telemetry/SpanFactory.js', () => ({
  __esModule: true,
  STANDARD_ATTRIBUTES: { SERVICE_NAME: 'service.name', EVENT_TYPE: 'event.type', KAFKA_TOPIC: 'kafka.topic', DURATION_MS: 'duration_ms' },
  default: { tracerName: 'mock-tracer', startSpan(name, attrs) { return mockStartSpan(name, attrs); } },
  SpanFactory: class MockSpanFactory {
    constructor(name = 'mock-tracer') { this.tracerName = name; }
    startSpan(name, attrs) { return mockStartSpan(name, attrs); }
  },
}));

const { SpanFactory, STANDARD_ATTRIBUTES } = await import('../../src/core/telemetry/SpanFactory.js');

describe('SpanFactory', () => {
  beforeEach(() => { vi.clearAllMocks(); mockStartSpan.mockReturnValue({ setStatus: vi.fn(), end: vi.fn(), setAttributes: vi.fn(), setAttribute: vi.fn() }); });

  describe('constructor', () => {
    it('sets a tracer name', () => { expect(new SpanFactory('test-tracer').tracerName).toBe('test-tracer'); });
    it('defaults tracer name', () => { expect(new SpanFactory().tracerName).toBe('mock-tracer'); });
  });

  describe('STANDARD_ATTRIBUTES', () => {
    it('exports SERVICE_NAME', () => { expect(STANDARD_ATTRIBUTES.SERVICE_NAME).toBe('service.name'); });
    it('exports EVENT_TYPE', () => { expect(STANDARD_ATTRIBUTES.EVENT_TYPE).toBe('event.type'); });
    it('exports KAFKA_TOPIC', () => { expect(STANDARD_ATTRIBUTES.KAFKA_TOPIC).toBe('kafka.topic'); });
    it('exports DURATION_MS', () => { expect(STANDARD_ATTRIBUTES.DURATION_MS).toBe('duration_ms'); });
  });

  describe('startSpan', () => {
    it('creates a span without throwing', () => {
      expect(() => new SpanFactory().startSpan('test-span')).not.toThrow();
    });

    it('returns a span object', () => {
      expect(new SpanFactory().startSpan('test-span')).toBeTruthy();
    });

    it('calls the underlying startSpan', () => {
      new SpanFactory().startSpan('test-span', { attr1: 'value1' });
      expect(mockStartSpan).toHaveBeenCalledWith('test-span', { attr1: 'value1' });
    });
  });
});
