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

vi.mock('../../api/src/config/db.js', () => ({ supabase: {} }));
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
