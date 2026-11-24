import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InternalEventAdapter } from '../../../src/core/events/adapters/InternalEventAdapter.js';

describe('InternalEventAdapter lifecycle', () => {
  let adapter;

  beforeEach(() => {
    adapter = new InternalEventAdapter();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  it('delivers the full event object to a subscriber', async () => {
    const listener = vi.fn();
    const event = {
      eventType: 'trip:created',
      payload: { tripId: 'trip_123', driverId: 'drv_456' },
    };

    await adapter.subscribe('trip:created', listener);
    await adapter.publish(event);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(event);
  });

  it('delivers an event to every listener for the topic', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const event = { eventType: 'location:update', lat: 13.08, lng: 80.27 };

    await adapter.subscribe('location:update', first);
    await adapter.subscribe('location:update', second);
    await adapter.publish(event);

    expect(first).toHaveBeenCalledWith(event);
    expect(second).toHaveBeenCalledWith(event);
  });

  it('stops delivery after unsubscribe', async () => {
    const listener = vi.fn();

    await adapter.subscribe('payment:processed', listener);
    await adapter.publish({ eventType: 'payment:processed', amount: 500 });
    expect(listener).toHaveBeenCalledTimes(1);

    await adapter.unsubscribe('payment:processed', listener);
    await adapter.publish({ eventType: 'payment:processed', amount: 600 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('rejects publish and subscribe after disconnect', async () => {
    await adapter.disconnect();

    expect(adapter.isConnected).toBe(false);
    await expect(adapter.publish({ eventType: 'trip:created' })).rejects.toThrow('Not connected');
    await expect(adapter.subscribe('trip:created', vi.fn())).rejects.toThrow('Not connected');
  });

  it('can reconnect and publish again', async () => {
    const listener = vi.fn();

    await adapter.disconnect();
    await adapter.connect();
    await adapter.subscribe('trip:created', listener);
    await adapter.publish({ eventType: 'trip:created', payload: { tripId: 'trip-2' } });

    expect(adapter.isConnected).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
