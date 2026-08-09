import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import eventBus, { EventBus } from '../../../src/core/events/EventBus.js';
import { BaseEvent } from '../../../src/core/events/BaseEvent.js';

describe('EventBus', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus();
  });

  afterEach(() => {
    bus.removeAllListeners();
    bus.clearMetrics();
  });

  describe('publish and subscribe', () => {
    it('should publish and receive events via string type', () => {
      const handler = vi.fn();
      bus.subscribe('test:simple', handler);

      bus.publish('test:simple', { value: 42 });

      expect(handler).toHaveBeenCalledTimes(1);
      const received = handler.mock.calls[0][0];
      expect(received.metadata.eventType).toBe('test:simple');
      expect(received.payload).toEqual({ value: 42 });
      expect(received.metadata.eventId).toBeDefined();
    });

    it('should publish and receive BaseEvent instances', () => {
      const handler = vi.fn();
      bus.subscribe('test:base', handler);

      const event = new BaseEvent({
        eventType: 'test:base',
        payload: { foo: 'bar' },
        source: 'test-source',
      });
      bus.publish(event);

      expect(handler).toHaveBeenCalledTimes(1);
      const received = handler.mock.calls[0][0];
      expect(received.eventType).toBe('test:base');
      expect(received.payload).toEqual({ foo: 'bar' });
      expect(received.source).toBe('test-source');
    });

    it('should support EventHandler instances', () => {
      const handler = vi.fn();
      const wrapped = { handle: handler };
      bus.subscribe('test:wrapped', wrapped);

      bus.publish('test:wrapped', { data: true });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should throw for invalid subscribe arguments', () => {
      expect(() => bus.subscribe('test', 'not-a-function')).toThrow('subscribe() requires a function or EventHandler instance');
    });
  });

  describe('emitSafe', () => {
    it('should emit safely and catch async errors', () => {
      const listener = vi.fn();
      bus.on('safe:test', listener);
      bus.emitSafe('safe:test', { payload: 'data' });
      expect(listener).toHaveBeenCalledWith({ payload: 'data' });
    });

    it('should return false when no listeners', () => {
      const result = bus.emitSafe('no:listeners', {});
      expect(result).toBe(false);
    });

    it('should catch async listener errors', async () => {
      const errorListener = vi.fn().mockRejectedValue(new Error('async error'));
      bus.on('safe:async', errorListener);

      bus.emitSafe('safe:async', {});

      await new Promise(r => setTimeout(r, 10));
      expect(bus.metrics.errors).toBe(1);
    });

    it('should catch sync listener errors', () => {
      const errorListener = vi.fn().mockImplementation(() => { throw new Error('sync error'); });
      bus.on('safe:sync', errorListener);

      bus.emitSafe('safe:sync', {});
      expect(bus.metrics.errors).toBe(1);
    });

    it('should notify multiple listeners safely', () => {
      const l1 = vi.fn();
      const l2 = vi.fn();
      bus.on('multi', l1);
      bus.on('multi', l2);
      bus.emitSafe('multi', 123);
      expect(l1).toHaveBeenCalledWith(123);
      expect(l2).toHaveBeenCalledWith(123);
    });
  });

  describe('metrics', () => {
    it('should track published count', () => {
      bus.publish('metrics:test', {});
      expect(bus.metrics.published).toBe(1);
    });

    it('should track subscribed count', () => {
      bus.subscribe('metrics:sub', () => {});
      expect(bus.metrics.subscribed).toBe(1);
    });

    it('should clear metrics', () => {
      bus.publish('metrics:clear', {});
      bus.clearMetrics();
      expect(bus.metrics.published).toBe(0);
    });
  });

  describe('deduplication', () => {
    it('should deduplicate events by eventId', () => {
      const handler = vi.fn();
      bus.subscribe('dedup:test', handler);

      const event = new BaseEvent({ eventType: 'dedup:test', payload: { v: 1 } });
      bus.publish(event);
      bus.publish(event);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(bus.metrics.deduplicated).toBe(1);
    });

    it('should not deduplicate when deduplicate option is false', () => {
      const handler = vi.fn();
      bus.subscribe('dedup:off', handler);

      const event = new BaseEvent({ eventType: 'dedup:off', payload: { v: 1 } });
      bus.publish(event, { deduplicate: false });
      bus.publish(event, { deduplicate: false });

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('adapters', () => {
    it('should publish to registered adapters', async () => {
      const mockAdapter = { publish: vi.fn(), connect: vi.fn(), disconnect: vi.fn() };
      bus.registerAdapter('mock', mockAdapter);

      const event = new BaseEvent({ eventType: 'adapter:test', payload: {} });
      bus.publish(event);

      await new Promise(r => setTimeout(r, 10));
      expect(mockAdapter.publish).toHaveBeenCalledTimes(1);
    });

    it('should skip adapters when adapters option is false', async () => {
      const mockAdapter = { publish: vi.fn() };
      bus.registerAdapter('mock', mockAdapter);

      bus.publish('adapter:skip', {}, { adapters: false });

      expect(mockAdapter.publish).not.toHaveBeenCalled();
    });

    it('should target specific adapters', async () => {
      const adapter1 = { publish: vi.fn() };
      const adapter2 = { publish: vi.fn() };
      bus.registerAdapter('a1', adapter1);
      bus.registerAdapter('a2', adapter2);

      bus.publish('adapter:target', {}, { adapters: ['a1'] });

      await new Promise(r => setTimeout(r, 10));
      expect(adapter1.publish).toHaveBeenCalled();
      expect(adapter2.publish).not.toHaveBeenCalled();
    });

    it('should remove adapters', async () => {
      const mockAdapter = { publish: vi.fn() };
      bus.registerAdapter('to-remove', mockAdapter);
      bus.removeAdapter('to-remove');

      bus.publish('adapter:removed', {}, { adapters: ['to-remove'] });
      await new Promise(r => setTimeout(r, 10));

      expect(mockAdapter.publish).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe a handler', () => {
      const handler = vi.fn();
      bus.subscribe('unsub:test', handler);
      bus.publish('unsub:test', {});
      expect(handler).toHaveBeenCalledTimes(1);

      bus.unsubscribe('unsub:test', handler);
      bus.publish('unsub:test', {});
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('publishAsync', () => {
    it('should resolve after publishing', async () => {
      const handler = vi.fn();
      bus.subscribe('async:test', handler);

      await bus.publishAsync('async:test', { val: 1 });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should reject on error', async () => {
      await expect(bus.publishAsync(null)).rejects.toThrow();
    });
  });
});
