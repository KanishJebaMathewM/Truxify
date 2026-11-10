import { describe, it, expect, vi } from 'vitest';
import eventBus from '../../../src/core/events/EventBus.js';
import { BaseEvent } from '../../../src/core/events/BaseEvent.js';

describe('Backward Compatibility - core/events.js re-export', () => {
  it('should import eventBus from legacy path', async () => {
    const legacy = await import('../../../src/core/events.js');
    expect(legacy.eventBus).toBeDefined();
    expect(typeof legacy.eventBus.emitSafe).toBe('function');
    expect(typeof legacy.eventBus.publish).toBe('function');
    expect(typeof legacy.eventBus.subscribe).toBe('function');
  });

  it('legacy eventBus should have emitSafe', async () => {
    const { eventBus: legacy } = await import('../../../src/core/events.js');
    const handler = vi.fn();
    legacy.on('compat:test', handler);
    legacy.emitSafe('compat:test', { v: 1 });
    expect(handler).toHaveBeenCalledWith({ v: 1 });
  });

  it('legacy eventBus should support publish/subscribe', async () => {
    const { eventBus: legacy } = await import('../../../src/core/events.js');
    const handler = vi.fn();
    legacy.subscribe('compat:pubsub', handler);
    legacy.publish('compat:pubsub', { data: 'yes' });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('EventBus integration with BaseEvent', () => {
  it('should propagate metadata through publish/subscribe cycle', () => {
    const handler = vi.fn();
    const bus = new (Object.getPrototypeOf(eventBus).constructor)();

    bus.subscribe('integration:test', handler);

    const event = new BaseEvent({
      eventType: 'integration:test',
      payload: { orderId: '123' },
      source: 'integration-test',
    });
    bus.publish(event);

    expect(handler).toHaveBeenCalledTimes(1);
    const received = handler.mock.calls[0][0];
    expect(received.eventType).toBe('integration:test');
    expect(received.payload).toEqual({ orderId: '123' });
    expect(received.source).toBe('integration-test');
    expect(received.metadata.eventId).toBeDefined();
    expect(received.metadata.timestamp).toBeDefined();

    bus.removeAllListeners();
  });
});
