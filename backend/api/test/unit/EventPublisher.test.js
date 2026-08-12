import { describe, it, expect } from 'vitest';
import { EventPublisher } from '../../src/core/events/EventPublisher.js';

describe('EventPublisher', () => {
  it('throws when publish() is called directly on base class', async () => {
    const publisher = new EventPublisher();
    await expect(publisher.publish({})).rejects.toThrow('EventPublisher.publish() must be implemented by adapter');
  });

  it('defaults isConnected to false', () => {
    const publisher = new EventPublisher();
    expect(publisher.isConnected).toBe(false);
  });
});
