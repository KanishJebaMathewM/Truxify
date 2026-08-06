import { describe, it, expect } from 'vitest';
import { EventSubscriber } from '../../src/core/events/EventSubscriber.js';

describe('EventSubscriber', () => {
  it('throws when subscribe() is called directly on base class', async () => {
    const subscriber = new EventSubscriber();
    await expect(subscriber.subscribe('TEST_EVENT', () => {})).rejects.toThrow('EventSubscriber.subscribe() must be implemented by adapter');
  });

  it('defaults isConnected to false', () => {
    const subscriber = new EventSubscriber();
    expect(subscriber.isConnected).toBe(false);
  });
});
