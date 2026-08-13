/**
 * Unit tests for the transactional outbox relay and the Kafka event envelope.
 *
 * Covers the core guarantees of the unified pipeline (Issue #1):
 *   - the envelope keeps eventId and aggregateId (order id) DISTINCT — the
 *     event uuid is never used as the order id
 *   - the Kafka key is the real aggregate/order id
 *   - rows are marked published only after a successful publish
 *   - a Kafka failure returns the row to 'pending' (never lost, retried)
 *   - the relay handles batches and empty claims
 *
 * Run with:  npm test -- test/outbox.relay.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/kafka.config.js', () => ({
  TOPICS: {
    ORDER_CREATED: 'order.created',
    ORDER_UPDATED: 'order.updated',
    ORDER_CANCELLED: 'order.cancelled',
    DRIVER_ASSIGNED: 'driver.assigned',
  },
  default: {},
}));

vi.mock('../../api/src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { OutboxRelay, buildOrderEventEnvelope } from '../relay/outbox.relay.js';

const ORDER_ID = '9f8e7d6c-5b4a-4321-9876-0fedcba98765';

function outboxRow(overrides = {}) {
  return {
    event_id: 'evt-1234',
    aggregate_id: ORDER_ID,
    event_type: 'ORDER_CREATED',
    payload: { id: ORDER_ID, status: 'pending', customer_id: 'cust-1' },
    version: 1,
    created_at: '2026-08-10T10:00:00.000Z',
    ...overrides,
  };
}

describe('buildOrderEventEnvelope', () => {
  it('keeps eventId and aggregateId/orderId as DISTINCT concepts', () => {
    const envelope = buildOrderEventEnvelope(outboxRow());
    expect(envelope.eventId).toBe('evt-1234');
    expect(envelope.aggregateId).toBe(ORDER_ID);
    expect(envelope.orderId).toBe(ORDER_ID);
    expect(envelope.eventId).not.toBe(envelope.orderId);
  });

  it('carries the real order id, never the event id', () => {
    const envelope = buildOrderEventEnvelope(outboxRow());
    expect(envelope.orderId).toBe(ORDER_ID);
    expect(envelope.orderId).not.toBe('evt-1234');
  });

  it('includes eventType, payload, timestamp and version', () => {
    const envelope = buildOrderEventEnvelope(outboxRow());
    expect(envelope.eventType).toBe('ORDER_CREATED');
    expect(envelope.payload.status).toBe('pending');
    expect(envelope.timestamp).toBe('2026-08-10T10:00:00.000Z');
    expect(envelope.version).toBe(1);
  });

  it('parses stringified payloads from the database', () => {
    const envelope = buildOrderEventEnvelope(outboxRow({ payload: JSON.stringify({ status: 'in_transit' }) }));
    expect(envelope.payload).toEqual({ status: 'in_transit' });
  });

  it('maps an ORDER_CANCELLED row while still keying on the order id', () => {
    const envelope = buildOrderEventEnvelope(outboxRow({ event_type: 'ORDER_CANCELLED' }));
    expect(envelope.eventType).toBe('ORDER_CANCELLED');
    expect(envelope.aggregateId).toBe(ORDER_ID);
  });
});

describe('OutboxRelay.publishPending', () => {
  let repository;
  let publisher;
  let relay;

  beforeEach(() => {
    repository = {
      claimPending: vi.fn().mockResolvedValue([]),
      markPublished: vi.fn().mockResolvedValue(),
      markFailed: vi.fn().mockResolvedValue(),
    };
    publisher = {
      publish: vi.fn().mockResolvedValue({ success: true }),
    };
    relay = new OutboxRelay({
      repository,
      publisher: async ({ topic, key, envelope }) => publisher.publish({ topic, key, envelope }),
      loggerAdapter: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    });
  });

  it('publishes each claimed event with the REAL order id as the Kafka key', async () => {
    const row = outboxRow();
    repository.claimPending.mockResolvedValue([row]);

    const results = await relay.publishPending({ limit: 100 });

    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const call = publisher.publish.mock.calls[0][0];
    expect(call.key).toBe(ORDER_ID);
    expect(call.topic).toBe('order.created');
    expect(call.envelope.eventId).toBe('evt-1234');
    expect(call.envelope.aggregateId).toBe(ORDER_ID);
    expect(call.envelope.orderId).toBe(ORDER_ID);
    // The Kafka key must be the order id, not the event id.
    expect(call.key).not.toBe('evt-1234');
    expect(results).toEqual({ claimed: 1, published: 1, failed: 0 });
  });

  it('marks rows published ONLY after the Kafka send succeeded', async () => {
    repository.claimPending.mockResolvedValue([outboxRow()]);
    publisher.publish.mockResolvedValue({ success: true });

    await relay.publishPending();

    expect(repository.markPublished).toHaveBeenCalledWith(['evt-1234']);
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it('returns a failed row to pending on Kafka failure (event is never lost)', async () => {
    repository.claimPending.mockResolvedValue([outboxRow()]);
    publisher.publish.mockRejectedValue(new Error('Broker unavailable'));

    const results = await relay.publishPending();

    expect(results).toEqual({ claimed: 1, published: 0, failed: 1 });
    expect(repository.markPublished).not.toHaveBeenCalled();
    expect(repository.markFailed).toHaveBeenCalledWith(['evt-1234'], 'Broker unavailable');
  });

  it('does not publish rows whose event type has no mapped topic', async () => {
    repository.claimPending.mockResolvedValue([outboxRow({ event_type: 'UNKNOWN_EVENT' })]);

    const results = await relay.publishPending();

    expect(publisher.publish).not.toHaveBeenCalled();
    expect(repository.markFailed).toHaveBeenCalled();
    expect(results.failed).toBe(1);
  });

  it('is a no-op when there are no pending rows', async () => {
    const results = await relay.publishPending();
    expect(results).toEqual({ claimed: 0, published: 0, failed: 0 });
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('keeps publishing remaining rows when a later row fails', async () => {
    repository.claimPending.mockResolvedValue([
      outboxRow({ event_id: 'evt-1' }),
      outboxRow({ event_id: 'evt-2' }),
      outboxRow({ event_id: 'evt-3' }),
    ]);
    publisher.publish
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ success: true });

    const results = await relay.publishPending();

    expect(results).toEqual({ claimed: 3, published: 2, failed: 1 });
    expect(repository.markPublished).toHaveBeenCalledWith(['evt-1']);
    expect(repository.markFailed).toHaveBeenCalledWith(['evt-2'], 'boom');
    expect(repository.markPublished).toHaveBeenCalledWith(['evt-3']);
  });

  it('uses the configured topic mapper', async () => {
    repository.claimPending.mockResolvedValue([outboxRow({ event_type: 'ORDER_UPDATED' })]);
    const customRelay = new OutboxRelay({
      repository,
      publisher: async ({ topic }) => publisher.publish({ topic }),
      topicFor: () => 'custom.topic',
      loggerAdapter: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    });

    await customRelay.publishPending();

    expect(publisher.publish).toHaveBeenCalledWith({ topic: 'custom.topic' });
  });
});
