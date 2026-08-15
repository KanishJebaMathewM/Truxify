/**
 * Unit tests for backend/kafka/repositories/event.repository.js
 *
 * Regression test for issue #11210: event replay used the order id as the
 * Kafka message key, but consumers derive the idempotency claim key from the
 * Kafka message key (eventId). Replays were therefore claimed under the order
 * id and silently dropped, so replays never reached read models.
 *
 * Coverage:
 *   - reemitEvent uses the event id (not the order id) as the Kafka key
 *   - reemitEvent mirrors eventId into metadata for the consumer's claim
 *   - reemitEvent skips replay when no topic is mapped
 *
 * Run with:  npm test -- test/event.repository.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const publishEvent = vi.fn(() => Promise.resolve({}));

vi.mock('../config/kafka.config.js', () => ({
  default: { publishEvent },
  TOPICS: { ORDER_CREATED: 'order.created', DRIVER_ASSIGNED: 'driver.assigned' },
}));

// Configurable supabase mock so we can drive the rows returned by the
// event repository queries without a real database. It emulates the
// repository's `order('timestamp', {ascending:false})` sort so the
// rebuild logic (which reverses the rows) applies events oldest-first.
let eventRows = [];
const queryChain = {
  select: () => queryChain,
  eq: () => queryChain,
  order: () => queryChain,
  limit: () => queryChain,
  then: (resolve) =>
    resolve({
      data: [...eventRows].sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0)),
      error: null,
    }),
};
vi.mock('../../api/src/config/db.js', () => ({
  supabase: { from: () => queryChain },
}));
vi.mock('../../api/src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import eventRepository from '../repositories/event.repository.js';

describe('EventRepository.reemitEvent', () => {
  beforeEach(() => {
    publishEvent.mockClear();
  });

  it('uses the event id (not the order id) as the Kafka message key', async () => {
    const event = {
      event_id: 'evt-abc',
      event_type: 'ORDER_CREATED',
      order_id: 'order-xyz',
      data: { foo: 'bar' },
      metadata: { timestamp: '2020-01-01T00:00:00Z' },
    };
    await eventRepository.reemitEvent(event);
    expect(publishEvent).toHaveBeenCalledTimes(1);
    const [, , key] = publishEvent.mock.calls[0];
    expect(key).toBe('evt-abc');
  });

  it('mirrors eventId into metadata so the consumer idempotency claim matches', async () => {
    const event = {
      event_id: 'evt-abc',
      event_type: 'ORDER_CREATED',
      order_id: 'order-xyz',
      data: {},
      metadata: {},
    };
    await eventRepository.reemitEvent(event);
    const [topic, payload, key] = publishEvent.mock.calls[0];
    expect(topic).toBe('order.created');
    expect(key).toBe('evt-abc');
    expect(payload.metadata.eventId).toBe('evt-abc');
    expect(payload.metadata.isReplay).toBe(true);
  });

  it('skips replay when no topic is mapped', async () => {
    await eventRepository.reemitEvent({
      event_id: 'e',
      event_type: 'UNKNOWN_TYPE',
      order_id: 'o',
      metadata: {},
    });
    expect(publishEvent).not.toHaveBeenCalled();
  });
});

/**
 * Regression tests for issue #14702: replayEvents/getSnapshot previously
 * truncated the event window to the newest 100 events, permanently dropping
 * older events (ORDER_CREATED, DRIVER_ASSIGNED, ...) on read-model rebuild.
 * They also had no deterministic tiebreaker for same-millisecond timestamps.
 */
describe('EventRepository rebuild paths (issue #14702)', () => {
  beforeEach(() => {
    publishEvent.mockClear();
    eventRows = [];
  });

  it('replayEvents re-emits EVERY event, not just the newest 100', async () => {
    const orderId = 'order-14702';
    const types = ['ORDER_CREATED', 'DRIVER_ASSIGNED'];
    // 150 events so the old 100-event limit would have dropped 50 of them.
    for (let i = 1; i <= 150; i += 1) {
      eventRows.push({
        event_id: `evt-${i}`,
        event_type: types[i % types.length],
        order_id: orderId,
        data: { seq: i },
        metadata: { timestamp: new Date(Date.UTC(2020, 0, 1, 0, 0, i)).toISOString() },
        timestamp: new Date(Date.UTC(2020, 0, 1, 0, 0, i)).toISOString(),
      });
    }

    await eventRepository.replayEvents(orderId);

    // Every one of the 150 events must be re-emitted, including the oldest.
    expect(publishEvent).toHaveBeenCalledTimes(150);
    const reemittedIds = publishEvent.mock.calls.map((c) => c[1].eventId);
    expect(reemittedIds).toContain('evt-1');
    expect(reemittedIds).toContain('evt-150');
  });

  it('getSnapshot rebuilds full state from ALL events, not just the newest 100', async () => {
    const orderId = 'order-14702';
    eventRows.push({
      event_id: 'evt-1',
      event_type: 'ORDER_CREATED',
      order_id: orderId,
      data: { amount: 100 },
      metadata: { timestamp: '2020-01-01T00:00:01Z' },
      timestamp: '2020-01-01T00:00:01Z',
    });
    // 149 newer events that would have pushed ORDER_CREATED out of a 100-window.
    for (let i = 2; i <= 150; i += 1) {
      eventRows.push({
        event_id: `evt-${i}`,
        event_type: 'TRIP_COMPLETED',
        order_id: orderId,
        data: { seq: i },
        metadata: { timestamp: new Date(Date.UTC(2020, 0, 1, 0, 0, i)).toISOString() },
        timestamp: new Date(Date.UTC(2020, 0, 1, 0, 0, i)).toISOString(),
      });
    }

    const snapshot = await eventRepository.getSnapshot(orderId);

    // The oldest ORDER_CREATED payload must survive the rebuild.
    expect(snapshot.data.amount).toBe(100);
    expect(snapshot.status).toBe('completed');
    // Timeline must contain every event, oldest through newest.
    expect(snapshot.timeline).toHaveLength(150);
    expect(snapshot.timeline[0].eventId).toBe('evt-1');
    expect(snapshot.timeline[149].eventId).toBe('evt-150');
  });
});

