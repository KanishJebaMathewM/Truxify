import { describe, it, expect, vi } from 'vitest';
import { EventPublisher } from '../../../../src/core/events/EventPublisher.js';

describe('EventPublisher adapter contract', () => {
  it('publish throws the must-be-implemented error on the base class', async () => {
    const publisher = new EventPublisher();
    await expect(publisher.publish({ metadata: { eventType: 'order.created' } })).rejects.toThrow(
      'EventPublisher.publish() must be implemented by adapter',
    );
  });

  it('publishBatch publishes every event in order', async () => {
    const published = [];
    const publisher = new EventPublisher();
    publisher.publish = vi.fn(async (event) => {
      published.push(event.metadata.eventType);
    });

    await publisher.publishBatch([
      { metadata: { eventType: 'order.created' } },
      { metadata: { eventType: 'order.cancelled' } },
      { metadata: { eventType: 'order.delivered' } },
    ]);

    expect(publisher.publish).toHaveBeenCalledTimes(3);
    expect(published).toEqual(['order.created', 'order.cancelled', 'order.delivered']);
  });

  it('publishBatch completes without calling publish when the batch is empty', async () => {
    const publisher = new EventPublisher();
    publisher.publish = vi.fn();
    await expect(publisher.publishBatch([])).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('publishBatch re-throws the first failure and stops publishing', async () => {
    const published = [];
    const publisher = new EventPublisher();
    publisher.publish = vi.fn(async (event) => {
      if (event.metadata.eventType === 'order.cancelled') {
        throw new Error('adapter rejected event');
      }
      published.push(event.metadata.eventType);
    });

    await expect(
      publisher.publishBatch([
        { metadata: { eventType: 'order.created' } },
        { metadata: { eventType: 'order.cancelled' } },
        { metadata: { eventType: 'order.delivered' } },
      ]),
    ).rejects.toThrow('adapter rejected event');

    expect(publisher.publish).toHaveBeenCalledTimes(2);
    expect(published).toEqual(['order.created']);
  });

  it('connect resolves without side effects on the base class', async () => {
    const publisher = new EventPublisher();
    await expect(publisher.connect()).resolves.toBeUndefined();
  });

  it('disconnect resolves without side effects on the base class', async () => {
    const publisher = new EventPublisher();
    await expect(publisher.disconnect()).resolves.toBeUndefined();
  });

  it('isConnected is false on a bare instance', () => {
    const publisher = new EventPublisher();
    expect(publisher.isConnected).toBe(false);
  });
});
