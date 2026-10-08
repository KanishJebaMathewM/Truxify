import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { EventStore } from '../event-store.js';
import { EventStoreValidationError } from '../errors.js';

const silentLogger = { info() {}, warn() {}, error() {} };

describe('legacy Kafka event publishing', () => {
  test('uses distinct stable event identities for updates to one order and for redelivery', async () => {
    const published = [];
    const store = new EventStore({ logger: silentLogger });
    store._loadKafka = async () => ({
      default: {
        publishEvent: async (topic, value, key) => published.push({ topic, value, key }),
      },
    });

    const first = {
      id: 'event-1',
      type: 'ORDER_UPDATED',
      aggregateId: 'order-1',
      payload: { status: 'PICKED_UP' },
      metadata: { source: 'event-store' },
    };
    const second = { ...first, id: 'event-2', payload: { status: 'IN_TRANSIT' } };

    await store.publishEvent(first);
    await store.publishEvent(second);
    await store.publishEvent(first);

    assert.deepEqual(published.map(({ key }) => key), ['event-1', 'event-2', 'event-1']);
    assert.deepEqual(published.map(({ value }) => value.eventId), ['event-1', 'event-2', 'event-1']);
    assert.deepEqual(published.map(({ value }) => value.metadata.eventId), ['event-1', 'event-2', 'event-1']);
    assert.ok(published.every(({ topic, value }) =>
      topic === 'order.updated' &&
      value.eventType === 'ORDER_UPDATED' &&
      value.orderId === 'order-1' &&
      value.aggregateId === 'order-1' &&
      value.metadata.source === 'event-store'
    ));
    assert.deepEqual(published[0].value.payload, first.payload);
    assert.deepEqual(published[1].value.payload, second.payload);
  });

  test('rejects events without a persisted identity instead of generating a new one', async () => {
    const store = new EventStore({ logger: silentLogger });
    let publishCalled = false;
    store._loadKafka = async () => ({ default: { publishEvent: async () => { publishCalled = true; } } });

    await assert.rejects(
      store.publishEvent({ type: 'ORDER_UPDATED', aggregateId: 'order-1', payload: {} }),
      EventStoreValidationError,
    );
    assert.equal(publishCalled, false);
  });
});
