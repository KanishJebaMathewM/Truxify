/**
 * Regression tests for the legacy event-store Kafka key fix (Issue #11283).
 *
 * The bug: backend/eventsourcing/event-store.js published to Kafka with
 * `event.aggregateId` (the order UUID) as the message key. Consumers that
 * resolve the idempotency claim from `message?.metadata?.eventId || key`
 * (order.consumer.js) then keyed every event of an order on the same topic by
 * the ORDER id, so two distinct events for one order (e.g. two ORDER_UPDATED)
 * produced the SAME claim key — the second was dropped as a duplicate.
 *
 * This test proves the legacy path now passes the EVENT id as the Kafka key:
 *   - two events sharing one orderId yield distinct message keys
 *   - the consumer-side claim key (metadata.eventId || key) stays distinct
 *   - without the explicit event-id key the keys would collide (old behavior)
 *
 * Run with:  npm test -- test/event-store-kafka-key.test.js
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
const EVENT_1 = '11111111-1111-4111-8111-111111111111';
const EVENT_2 = '22222222-2222-4222-8222-222222222222';

// Shape produced by the legacy event-store.js publishEvent: no metadata.eventId,
// but an `id` field (the true event id) and a shared aggregateId/orderId.
function legacyEnvelope(id, status) {
  return {
    id,
    type: 'ORDER_UPDATED',
    aggregateId: ORDER_ID,
    payload: { status },
    metadata: { traceContext: 'trace-1' },
    timestamp: new Date().toISOString(),
  };
}

// Mirror of order.consumer.js claim-key resolution: metadata.eventId wins,
// otherwise the raw Kafka message key is used.
function resolveClaimKey(message, rawMessage) {
  return message?.metadata?.eventId || rawMessage?.key?.toString() || null;
}

describe('legacy event-store Kafka key (Issue #11283)', () => {
  beforeEach(() => {
    sentMessages.length = 0;
  });

  it('publishes two events of one order with distinct event-id keys', async () => {
    // Legacy path: event-store.js calls publishEvent(topic, enriched, event.id).
    await kafkaConfig.publishEvent('order.updated', legacyEnvelope(EVENT_1, 'CONFIRMED'), EVENT_1);
    await kafkaConfig.publishEvent('order.updated', legacyEnvelope(EVENT_2, 'CANCELLED'), EVENT_2);

    expect(sentMessages).toHaveLength(2);
    const keys = sentMessages.map((m) => m.key);

    expect(keys).toEqual([EVENT_1, EVENT_2]);
    expect(new Set(keys).size).toBe(2);
    expect(keys).not.toContain(ORDER_ID);
  });

  it('keeps consumer-side claim keys distinct per event on the same topic', async () => {
    await kafkaConfig.publishEvent('order.updated', legacyEnvelope(EVENT_1, 'CONFIRMED'), EVENT_1);
    await kafkaConfig.publishEvent('order.updated', legacyEnvelope(EVENT_2, 'CANCELLED'), EVENT_2);

    const claimKeys = sentMessages.map((rawMessage) =>
      resolveClaimKey(JSON.parse(rawMessage.value), rawMessage)
    );

    expect(claimKeys).toEqual([EVENT_1, EVENT_2]);
    expect(new Set(claimKeys).size).toBe(2);
  });

  it('old behavior (aggregateId fallback) would collide the two events', async () => {
    // Without an explicit event-id key, publishEvent falls back to the
    // aggregate/order id — the pre-fix bug that caused dedup collisions.
    await kafkaConfig.publishEvent('order.updated', legacyEnvelope(EVENT_1, 'CONFIRMED'));
    await kafkaConfig.publishEvent('order.updated', legacyEnvelope(EVENT_2, 'CANCELLED'));

    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0].key).toBe(ORDER_ID);
    expect(sentMessages[1].key).toBe(ORDER_ID);

    const claimKeys = sentMessages.map((rawMessage) =>
      resolveClaimKey(JSON.parse(rawMessage.value), rawMessage)
    );
    expect(new Set(claimKeys).size).toBe(1);
  });
});
