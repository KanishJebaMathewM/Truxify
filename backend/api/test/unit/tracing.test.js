import { describe, it, expect } from 'vitest';
import tracing from '../../src/tracing/tracing.js';

describe('tracing module', () => {
  it('exports a singleton with expected methods', () => {
    expect(tracing).toBeDefined();
    expect(typeof tracing.initialize).toBe('function');
    expect(typeof tracing.getTracer).toBe('function');
    expect(typeof tracing.createSpan).toBe('function');
    expect(typeof tracing.addAttributes).toBe('function');
    expect(typeof tracing.addEvent).toBe('function');
    expect(typeof tracing.shutdown).toBe('function');
  });

  describe('addAttributes', () => {
    it('is a safe no-op when span is null', () => {
      expect(() => tracing.addAttributes(null, { a: 1 })).not.toThrow();
    });
  });

  describe('addEvent', () => {
    it('is a safe no-op when span is null', () => {
      expect(() => tracing.addEvent(null, 'evt')).not.toThrow();
    });
  });
});
