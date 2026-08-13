import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../../src/core/events/EventBus.js';

vi.mock('../../src/core/telemetry/SpanFactory.js', () => ({
  default: {
    startEventPublishSpan: vi.fn(() => ({ setStatus: vi.fn(), end: vi.fn(), recordError: vi.fn() })),
    startEventSubscribeSpan: vi.fn(() => ({ setStatus: vi.fn(), end: vi.fn(), recordError: vi.fn() })),
    recordError: vi.fn(),
  },
  STANDARD_ATTRIBUTES: {},
}));

describe('EventBus', () => {
  let bus;

  beforeEach(() => {
    vi.clearAllMocks();
    bus = new EventBus();
  });

  describe('constructor', () => {
    it('creates an event bus with initial metrics at zero', () => {
      const metrics = bus.metrics;
      expect(metrics.published).toBe(0);
      expect(metrics.subscribed).toBe(0);
      expect(metrics.errors).toBe(0);
    });
  });

  describe('registry', () => {
    it('exposes the event registry', () => {
      expect(bus.registry).toBeDefined();
    });
  });

  describe('registerAdapter', () => {
    it('registers an adapter and returns this for chaining', () => {
      const adapter = { name: 'test' };
      const result = bus.registerAdapter('kafka', adapter);
      expect(result).toBe(bus);
    });
  });

  describe('removeAdapter', () => {
    it('removes a registered adapter', () => {
      bus.registerAdapter('kafka', { name: 'test' });
      bus.removeAdapter('kafka');
      expect(bus._adapters.has('kafka')).toBe(false);
    });
  });

  describe('publish', () => {
    it('throws when called without a valid event or type', () => {
      expect(() => bus.publish(123)).toThrow('EventBus.publish() requires either a BaseEvent instance or (eventType, payload, options)');
    });

    it('increments published metric on successful publish', () => {
      const handler = vi.fn();
      bus.subscribe('test.event', handler);
      bus.publish('test.event', { value: 1 });
      expect(bus.metrics.published).toBe(1);
    });
  });

  describe('subscribe', () => {
    it('throws when handler is not a function or EventHandler', () => {
      expect(() => bus.subscribe('test.event', 'not a function')).toThrow('subscribe() requires a function or EventHandler instance');
    });

    it('increments subscribed metric on subscribe', () => {
      bus.subscribe('test.event', vi.fn());
      expect(bus.metrics.subscribed).toBe(1);
    });
  });

  describe('unsubscribe', () => {
    it('removes a subscribed handler', () => {
      const handler = vi.fn();
      bus.subscribe('test.event', handler);
      bus.unsubscribe('test.event', handler);
      bus.publish('test.event', {});
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('clearMetrics', () => {
    it('resets all metrics to zero', () => {
      bus.subscribe('test.event', vi.fn());
      bus.publish('test.event', {});
      bus.clearMetrics();
      expect(bus.metrics.published).toBe(0);
      expect(bus.metrics.subscribed).toBe(0);
      expect(bus.metrics.errors).toBe(0);
    });
  });
});
