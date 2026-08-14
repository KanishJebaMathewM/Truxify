/**
 * Regression tests for the Kafka envelope fix in
 * backend/kafka/config/kafka.config.js (Issue #1).
 *
 * The bug: `publishEvent` fell back to `event.eventId` as the Kafka message
 * key, so consumers that treated the key as the order/aggregate id ended up
 * using an event uuid as the order id.
 *
 * This test proves:
 *   - the message key is the REAL order/aggregate id, never the event id
 *   - when no explicit key is passed, aggregateId/orderId are preferred
 *   - the envelope preserves the event's own version (was clobbered to '1.0')
 *
 * Run with:  npm test -- test/envelope.regression.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sentMessages = [];

vi.mock('kafkajs', () => {
  class MockProducer {
    async connect() {}
    async send({ messages }) {
      sentMessages.push(...messages);
      return [{ topic: 't', partition: 0, offset: '1' }];
    }
    async disconnect() {}
  }
  return {
    Kafka: class {
      producer() {
        return new MockProducer();
      }
      consumer() {
        return { connect: async () => {}, subscribe: async () => {}, run: async () => {}, disconnect: async () => {} };
      }
      admin() {
        return { connect: async () => {}, createTopics: async () => {}, disconnect: async () => {} };
      }
    },
  };
});

vi.mock('@opentelemetry/api', () => ({
  context: { active: () => ({}) },
  propagation: { inject: () => {} },
}));

vi.mock('../../api/src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import kafkaConfig from '../config/kafka.config.js';

const ORDER_ID = '9f8e7d6c-5b4a-4321-9876-0fedcba98765';

describe('kafka.config publishEvent envelope', () => {
  beforeEach(() => {
    sentMessages.length = 0;
  });

  it('uses the real aggregate/order id as the Kafka key, never the event id', async () => {
    await kafkaConfig.publishEvent('order.created', {
      eventId: 'evt-1234',
      aggregateId: ORDER_ID,
      eventType: 'ORDER_CREATED',
      payload: { status: 'pending' },
      version: 3,
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].key).toBe(ORDER_ID);
    expect(sentMessages[0].key).not.toBe('evt-1234');
  });

  it('prefers an explicit key over the event fields', async () => {
    await kafkaConfig.publishEvent('order.created', {
      eventId: 'evt-1234',
      orderId: 'some-other-order',
    }, 'explicit-order-key');

    expect(sentMessages[0].key).toBe('explicit-order-key');
  });

  it('falls back to orderId (never eventId) when aggregateId is absent', async () => {
    await kafkaConfig.publishEvent('order.created', {
      eventId: 'evt-1234',
      orderId: ORDER_ID,
      eventType: 'ORDER_CREATED',
      payload: {},
    });

    expect(sentMessages[0].key).toBe(ORDER_ID);
    expect(sentMessages[0].key).not.toBe('evt-1234');
  });

  it('preserves the event version instead of clobbering it to "1.0"', async () => {
    await kafkaConfig.publishEvent('order.updated', {
      eventId: 'evt-5678',
      aggregateId: ORDER_ID,
      eventType: 'ORDER_UPDATED',
      payload: {},
      version: 7,
    });

    const value = JSON.parse(sentMessages[0].value);
    expect(value.version).toBe(7);
    expect(value.aggregateId).toBe(ORDER_ID);
    expect(value.eventId).toBe('evt-5678');
  });
});
