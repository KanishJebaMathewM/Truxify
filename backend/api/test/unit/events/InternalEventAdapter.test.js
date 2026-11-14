// backend/api/test/unit/events/InternalEventAdapter.test.js

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InternalEventAdapter } from '../../../src/events/InternalEventAdapter.js';

describe('InternalEventAdapter - Pub/Sub Lifecycle Unit Tests (#9681)', () => {
  let eventAdapter;

  beforeEach(() => {
    eventAdapter = new InternalEventAdapter();
    vi.clearAllMocks();
  });

  it('successfully publishes and delivers events to registered subscribers', async () => {
    const listener = vi.fn();
    const topic = 'trip:created';
    const payload = { tripId: 'trip_123', driverId: 'drv_456' };

    eventAdapter.subscribe(topic, listener);
    await eventAdapter.publish(topic, payload);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(payload);
  });

  it('supports unsubscribing listeners to stop receiving events', async () => {
    const listener = vi.fn();
    const topic = 'location:update';

    const unsubscribe = eventAdapter.subscribe(topic, listener);
    
    // Publish before unsubscribe
    await eventAdapter.publish(topic, { lat: 13.08, lng: 80.27 });
    expect(listener).toHaveBeenCalledTimes(1);

    // Unsubscribe and publish again
    unsubscribe();
    await eventAdapter.publish(topic, { lat: 13.09, lng: 80.28 });
    
    // Listener call count should remain 1
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('handles subscriber errors gracefully without breaking event publication', async () => {
    const faultyListener = vi.fn().mockImplementation(() => {
      throw new Error('Subscriber failure');
    });
    const healthyListener = vi.fn();
    const topic = 'payment:processed';

    eventAdapter.subscribe(topic, faultyListener);
    eventAdapter.subscribe(topic, healthyListener);

    // Publishing should not throw despite faulty subscriber
    await expect(eventAdapter.publish(topic, { amount: 500 })).resolves.not.toThrow();

    expect(faultyListener).toHaveBeenCalledTimes(1);
    expect(healthyListener).toHaveBeenCalledTimes(1);
  });
});
