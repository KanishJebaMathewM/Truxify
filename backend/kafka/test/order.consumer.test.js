/**
 * Unit tests for the unified Kafka order consumer
 * (backend/kafka/consumers/order.consumer.js).
 *
 * Covers Issue #1 consumer requirements:
 *   - order read-model topics are applied atomically (applyEvent) and a
 *     duplicate Kafka message never re-applies the read-model effect
 *   - consumer restart / replayed events are safe (same (topic,eventId) ->
 *     applied=false -> skipped)
 *   - side-effect topics keep the claim-first idempotency guard
 *   - handler errors are dead-lettered
 *
 * Run with:  npm test -- test/order.consumer.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORDER_ID = '9f8e7d6c-5b4a-4321-9876-0fedcba98765';

const captured = { messageHandler: null, errorHandler: null };

vi.mock('../../api/src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../config/kafka.config.js', () => ({
  TOPICS: {
    ORDER_CREATED: 'order.created',
    ORDER_UPDATED: 'order.updated',
    ORDER_CANCELLED: 'order.cancelled',
    DRIVER_ASSIGNED: 'driver.assigned',
    PAYMENT_CONFIRMED: 'payment.confirmed',
  },
  CONSUMER_GROUPS: {
    ORDER_SERVICE: 'order-service',
    NOTIFICATION_SERVICE: 'notification-service',
    ANALYTICS_SERVICE: 'analytics-service',
    FRAUD_SERVICE: 'fraud-service',
  },
  default: {
    createConsumer: vi.fn().mockResolvedValue({}),
    getConsumer: vi.fn().mockResolvedValue({}),
    consumeMessages: vi.fn((groupId, messageHandler, errorHandler) => {
      captured.messageHandler = messageHandler;
      captured.errorHandler = errorHandler;
    }),
  },
}));

const {
  applyEventMock,
  claimProcessingMock,
  markCompletedMock,
  markFailedMock,
  storeMock,
  listPendingMock,
  markStatusMock,
  getStatusMock,
} = vi.hoisted(() => ({
  applyEventMock: vi.fn(),
  claimProcessingMock: vi.fn(),
  markCompletedMock: vi.fn().mockResolvedValue(),
  markFailedMock: vi.fn().mockResolvedValue(),
  storeMock: vi.fn().mockResolvedValue({ id: 'dlq-1' }),
  listPendingMock: vi.fn().mockResolvedValue([]),
  markStatusMock: vi.fn().mockResolvedValue(),
  getStatusMock: vi.fn().mockResolvedValue('completed'),
}));

vi.mock('../cqrs/order.read.model.js', () => ({
  default: {
    applyEvent: applyEventMock,
  },
}));

vi.mock('../repositories/processedEvent.repository.js', () => ({
  default: {
    claimProcessing: claimProcessingMock,
    markCompleted: markCompletedMock,
    markFailed: markFailedMock,
    getStatus: getStatusMock,
  },
}));

vi.mock('../repositories/deadLetter.repository.js', () => ({
  default: {
    store: storeMock,
    listPending: listPendingMock,
    markStatus: markStatusMock,
  },
}));

import orderConsumer from '../consumers/order.consumer.js';
import orderReadModel from '../cqrs/order.read.model.js';
import logger from '../../api/src/middleware/logger.js';

function orderEventMessage({ eventId = 'evt-1234', orderId = ORDER_ID } = {}) {
  return {
    eventId,
    aggregateId: orderId,
    orderId,
    eventType: 'ORDER_CREATED',
    payload: { id: orderId, status: 'pending', customer_id: 'cust-1' },
    version: 1,
  };
}

describe('OrderConsumer order read-model topics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.messageHandler = null;
    orderConsumer.handlers.clear();
    applyEventMock.mockResolvedValue(true);
  });

  it('applies an order event atomically via the read model', async () => {
    await orderConsumer.startConsuming('order-service');
    const message = orderEventMessage();
    await captured.messageHandler('order.created', message, { key: Buffer.from(ORDER_ID) });

    expect(orderReadModel.applyEvent).toHaveBeenCalledTimes(1);
    const call = orderReadModel.applyEvent.mock.calls[0][0];
    expect(call.topic).toBe('order.created');
    expect(call.eventId).toBe('evt-1234');
    expect(call.orderId).toBe(ORDER_ID);
    expect(call.orderId).not.toBe('evt-1234');
  });

  it('skips a duplicate Kafka message (read-model effect not duplicated)', async () => {
    const handler = vi.fn();
    orderConsumer.registerHandler('order.created', handler);
    await orderConsumer.startConsuming('order-service');

    applyEventMock.mockResolvedValue(false);
    await captured.messageHandler('order.created', orderEventMessage(), { key: Buffer.from(ORDER_ID) });

    expect(orderReadModel.applyEvent).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it('is safe across consumer restarts: replayed event with same (topic,eventId) is a no-op', async () => {
    await orderConsumer.startConsuming('order-service');
    const message = orderEventMessage();
    // First delivery.
    applyEventMock.mockResolvedValueOnce(true);
    await captured.messageHandler('order.created', message, { key: Buffer.from(ORDER_ID) });
    // Replayed delivery after a restart.
    applyEventMock.mockResolvedValueOnce(false);
    await captured.messageHandler('order.created', message, { key: Buffer.from(ORDER_ID) });

    expect(orderReadModel.applyEvent).toHaveBeenCalledTimes(2);
    await expect(orderReadModel.applyEvent.mock.results[1].value).resolves.toBe(false);
  });

  it('uses the order id from the message key when the payload has no order id', async () => {
    await orderConsumer.startConsuming('order-service');
    const message = { eventId: 'evt-9', eventType: 'ORDER_UPDATED', payload: {} };
    await captured.messageHandler('order.updated', message, { key: Buffer.from(ORDER_ID) });

    const call = orderReadModel.applyEvent.mock.calls[0][0];
    expect(call.orderId).toBe(ORDER_ID);
  });
});

describe('OrderConsumer side-effect topics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.messageHandler = null;
    orderConsumer.handlers.clear();
    orderConsumer.setEventBus(null);
    claimProcessingMock.mockResolvedValue(true);
  });

  it('claims a side-effect event as processing, then completes it after handlers succeed', async () => {
    const handler = vi.fn().mockResolvedValue();
    orderConsumer.registerHandler('payment.confirmed', handler);
    await orderConsumer.startConsuming('order-service');

    await captured.messageHandler(
      'payment.confirmed',
      { metadata: { eventId: 'evt-pay-1' }, orderId: ORDER_ID },
      { key: Buffer.from(ORDER_ID) }
    );

    expect(claimProcessingMock).toHaveBeenCalledWith('payment.confirmed', 'evt-pay-1', ORDER_ID, 'order-service');
    expect(handler).toHaveBeenCalled();
    expect(markCompletedMock).toHaveBeenCalledWith('payment.confirmed', 'evt-pay-1', 'order-service');
    expect(markFailedMock).not.toHaveBeenCalled();
    expect(orderReadModel.applyEvent).not.toHaveBeenCalled();
  });

  it('skips a duplicate side-effect event without touching the claim state', async () => {
    const handler = vi.fn();
    orderConsumer.registerHandler('payment.confirmed', handler);
    await orderConsumer.startConsuming('order-service');

    claimProcessingMock.mockResolvedValue(false);
    await captured.messageHandler(
      'payment.confirmed',
      { metadata: { eventId: 'evt-pay-1' }, orderId: ORDER_ID },
      { key: Buffer.from(ORDER_ID) }
    );

    expect(handler).not.toHaveBeenCalled();
    expect(markCompletedMock).not.toHaveBeenCalled();
    expect(markFailedMock).not.toHaveBeenCalled();
  });

  it('marks a side-effect event failed when a handler throws (event retryable)', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('wallet provider down'));
    orderConsumer.registerHandler('payment.confirmed', handler);
    await orderConsumer.startConsuming('order-service');

    await captured.messageHandler(
      'payment.confirmed',
      { metadata: { eventId: 'evt-pay-2' }, orderId: ORDER_ID },
      { key: Buffer.from(ORDER_ID) }
    );

    expect(handler).toHaveBeenCalled();
    expect(markFailedMock).toHaveBeenCalledWith('payment.confirmed', 'evt-pay-2', 'order-service');
    expect(markCompletedMock).not.toHaveBeenCalled();
    // The failed message is still dead-lettered for manual inspection.
    expect(storeMock).toHaveBeenCalled();
  });

  it('marks a side-effect event failed when the EventBus fan-out throws', async () => {
    const handler = vi.fn().mockResolvedValue();
    orderConsumer.registerHandler('payment.confirmed', handler);
    const throwingEventBus = {
      publish: vi.fn().mockRejectedValue(new Error('event bus down')),
    };
    orderConsumer.setEventBus(throwingEventBus);
    await orderConsumer.startConsuming('order-service');

    await captured.messageHandler(
      'payment.confirmed',
      { metadata: { eventId: 'evt-pay-3' }, orderId: ORDER_ID },
      { key: Buffer.from(ORDER_ID) }
    );

    expect(markFailedMock).toHaveBeenCalledWith('payment.confirmed', 'evt-pay-3', 'order-service');
    expect(markCompletedMock).not.toHaveBeenCalled();
  });

  it('does not claim or resolve the claim for order read-model topics', async () => {
    const handler = vi.fn().mockResolvedValue();
    orderConsumer.registerHandler('order.created', handler);
    await orderConsumer.startConsuming('order-service');

    await captured.messageHandler('order.created', orderEventMessage(), { key: Buffer.from(ORDER_ID) });

    expect(claimProcessingMock).not.toHaveBeenCalled();
    expect(markCompletedMock).not.toHaveBeenCalled();
    expect(markFailedMock).not.toHaveBeenCalled();
  });
});

describe('OrderConsumer replayDeadLetters idempotency (Issue #11218)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orderConsumer.handlers.clear();
    orderConsumer.setEventBus(null);
    listPendingMock.mockResolvedValue([]);
    markStatusMock.mockResolvedValue();
    claimProcessingMock.mockResolvedValue(true);
    markCompletedMock.mockResolvedValue();
    markFailedMock.mockResolvedValue();
    getStatusMock.mockResolvedValue('completed');
    applyEventMock.mockResolvedValue(true);
  });

  it('skips handler and marks replayed when side-effect event was already completed', async () => {
    listPendingMock.mockResolvedValueOnce([
      {
        id: 'dlq-1',
        topic: 'payment.confirmed',
        message: JSON.stringify({ metadata: { eventId: 'evt-dlq-1' }, orderId: ORDER_ID }),
        retry_count: 0,
      },
    ]);
    claimProcessingMock.mockResolvedValueOnce(false);
    getStatusMock.mockResolvedValueOnce('completed');

    const handler = vi.fn();
    orderConsumer.registerHandler('payment.confirmed', handler);

    const res = await orderConsumer.replayDeadLetters();

    expect(claimProcessingMock).toHaveBeenCalledWith('payment.confirmed', 'evt-dlq-1', ORDER_ID, 'order-service');
    expect(getStatusMock).toHaveBeenCalledWith('payment.confirmed', 'evt-dlq-1', 'order-service');
    expect(handler).not.toHaveBeenCalled();
    expect(markStatusMock).toHaveBeenCalledWith('dlq-1', 'replayed');
    expect(markCompletedMock).not.toHaveBeenCalled();
    expect(markFailedMock).not.toHaveBeenCalled();
    expect(res.succeeded).toBe(1);
    expect(res.failed).toBe(0);
  });

  it('skips handler and leaves pending when side-effect event is actively in-flight on another replica', async () => {
    listPendingMock.mockResolvedValueOnce([
      {
        id: 'dlq-2',
        topic: 'payment.confirmed',
        message: JSON.stringify({ metadata: { eventId: 'evt-dlq-2' }, orderId: ORDER_ID }),
        retry_count: 0,
      },
    ]);
    claimProcessingMock.mockResolvedValueOnce(false);
    getStatusMock.mockResolvedValueOnce('processing');

    const handler = vi.fn();
    orderConsumer.registerHandler('payment.confirmed', handler);

    const res = await orderConsumer.replayDeadLetters();

    expect(claimProcessingMock).toHaveBeenCalledWith('payment.confirmed', 'evt-dlq-2', ORDER_ID, 'order-service');
    expect(handler).not.toHaveBeenCalled();
    expect(markStatusMock).not.toHaveBeenCalled();
    expect(res.failed).toBe(1);
    expect(res.succeeded).toBe(0);
  });

  it('claims, executes handler, and marks completed for a retryable/fresh side-effect event', async () => {
    listPendingMock.mockResolvedValueOnce([
      {
        id: 'dlq-3',
        topic: 'payment.confirmed',
        message: JSON.stringify({ metadata: { eventId: 'evt-dlq-3' }, orderId: ORDER_ID }),
        retry_count: 0,
      },
    ]);
    claimProcessingMock.mockResolvedValueOnce(true);

    const handler = vi.fn().mockResolvedValue();
    orderConsumer.registerHandler('payment.confirmed', handler);

    const res = await orderConsumer.replayDeadLetters();

    expect(claimProcessingMock).toHaveBeenCalledWith('payment.confirmed', 'evt-dlq-3', ORDER_ID, 'order-service');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(markStatusMock).toHaveBeenCalledWith('dlq-3', 'replayed');
    expect(markCompletedMock).toHaveBeenCalledWith('payment.confirmed', 'evt-dlq-3', 'order-service');
    expect(markFailedMock).not.toHaveBeenCalled();
    expect(res.succeeded).toBe(1);
    expect(res.failed).toBe(0);
  });

  it('marks failed and increments retry count when handler throws during replay of claimed event', async () => {
    listPendingMock.mockResolvedValueOnce([
      {
        id: 'dlq-4',
        topic: 'payment.confirmed',
        message: JSON.stringify({ metadata: { eventId: 'evt-dlq-4' }, orderId: ORDER_ID }),
        retry_count: 1,
      },
    ]);
    claimProcessingMock.mockResolvedValueOnce(true);

    const handler = vi.fn().mockRejectedValue(new Error('wallet service timeout'));
    orderConsumer.registerHandler('payment.confirmed', handler);

    const res = await orderConsumer.replayDeadLetters();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(markFailedMock).toHaveBeenCalledWith('payment.confirmed', 'evt-dlq-4', 'order-service');
    expect(markCompletedMock).not.toHaveBeenCalled();
    expect(markStatusMock).toHaveBeenCalledWith('dlq-4', 'pending', { incrementRetry: true });
    expect(res.failed).toBe(1);
    expect(res.succeeded).toBe(0);
  });

  it('marks failed permanently when handler fails and MAX_REPLAY_ATTEMPTS is reached', async () => {
    listPendingMock.mockResolvedValueOnce([
      {
        id: 'dlq-5',
        topic: 'payment.confirmed',
        message: JSON.stringify({ metadata: { eventId: 'evt-dlq-5' }, orderId: ORDER_ID }),
        retry_count: 3,
      },
    ]);
    claimProcessingMock.mockResolvedValueOnce(true);

    const handler = vi.fn().mockRejectedValue(new Error('persistent failure'));
    orderConsumer.registerHandler('payment.confirmed', handler);

    const res = await orderConsumer.replayDeadLetters();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(markFailedMock).toHaveBeenCalledWith('payment.confirmed', 'evt-dlq-5', 'order-service');
    expect(markStatusMock).toHaveBeenCalledWith('dlq-5', 'failed');
    expect(res.failed).toBe(1);
  });

  it('executes registered handlers and marks replayed when read-model event was already applied', async () => {
    listPendingMock.mockResolvedValueOnce([
      {
        id: 'dlq-6',
        topic: 'order.created',
        message: JSON.stringify(orderEventMessage({ eventId: 'evt-dlq-6' })),
        retry_count: 0,
      },
    ]);
    applyEventMock.mockResolvedValueOnce(false);

    const handler = vi.fn().mockResolvedValue();
    orderConsumer.registerHandler('order.created', handler);

    const res = await orderConsumer.replayDeadLetters();

    expect(applyEventMock).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(markStatusMock).toHaveBeenCalledWith('dlq-6', 'replayed');
    expect(res.succeeded).toBe(1);
    expect(res.failed).toBe(0);
  });

  it('preserves retry and does not mark replayed when handler fails after read-model projection was already applied', async () => {
    listPendingMock.mockResolvedValueOnce([
      {
        id: 'dlq-6b',
        topic: 'order.created',
        message: JSON.stringify(orderEventMessage({ eventId: 'evt-dlq-6b' })),
        retry_count: 0,
      },
    ]);
    applyEventMock.mockResolvedValueOnce(false);

    const handler = vi.fn().mockRejectedValue(new Error('handler downstream failure'));
    orderConsumer.registerHandler('order.created', handler);

    const res = await orderConsumer.replayDeadLetters();

    expect(applyEventMock).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(markStatusMock).not.toHaveBeenCalledWith('dlq-6b', 'replayed');
    expect(markStatusMock).toHaveBeenCalledWith('dlq-6b', 'pending', { incrementRetry: true });
    expect(res.succeeded).toBe(0);
    expect(res.failed).toBe(1);
  });

  it('continues batch without rejection and logs error when markCompleted throws during replay', async () => {
    listPendingMock.mockResolvedValueOnce([
      {
        id: 'dlq-mc-1',
        topic: 'payment.confirmed',
        message: JSON.stringify({ metadata: { eventId: 'evt-mc-1' }, orderId: ORDER_ID }),
        retry_count: 0,
      },
      {
        id: 'dlq-mc-2',
        topic: 'payment.confirmed',
        message: JSON.stringify({ metadata: { eventId: 'evt-mc-2' }, orderId: ORDER_ID }),
        retry_count: 0,
      },
    ]);
    claimProcessingMock.mockResolvedValue(true);
    markCompletedMock
      .mockRejectedValueOnce(new Error('DB failure on markCompleted'))
      .mockResolvedValueOnce();

    const handler = vi.fn().mockResolvedValue();
    orderConsumer.registerHandler('payment.confirmed', handler);

    const res = await orderConsumer.replayDeadLetters();

    expect(handler).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to resolve processing claim during replay for event evt-mc-1'),
      expect.any(Error)
    );
    expect(markStatusMock).toHaveBeenCalledWith('dlq-mc-1', 'replayed');
    expect(markStatusMock).toHaveBeenCalledWith('dlq-mc-2', 'replayed');
    expect(res.succeeded).toBe(2);
    expect(res.failed).toBe(0);
  });

  it('continues batch without rejection and logs error when markFailed throws during handler failure', async () => {
    listPendingMock.mockResolvedValueOnce([
      {
        id: 'dlq-mf-1',
        topic: 'payment.confirmed',
        message: JSON.stringify({ metadata: { eventId: 'evt-mf-1' }, orderId: ORDER_ID }),
        retry_count: 0,
      },
      {
        id: 'dlq-mf-2',
        topic: 'payment.confirmed',
        message: JSON.stringify({ metadata: { eventId: 'evt-mf-2' }, orderId: ORDER_ID }),
        retry_count: 0,
      },
    ]);
    claimProcessingMock.mockResolvedValue(true);
    markFailedMock
      .mockRejectedValueOnce(new Error('DB failure on markFailed'))
      .mockResolvedValueOnce();

    const handler = vi.fn()
      .mockRejectedValueOnce(new Error('handler error on entry 1'))
      .mockResolvedValueOnce();
    orderConsumer.registerHandler('payment.confirmed', handler);

    const res = await orderConsumer.replayDeadLetters();

    expect(handler).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to resolve processing claim during replay for event evt-mf-1'),
      expect.any(Error)
    );
    expect(markStatusMock).toHaveBeenCalledWith('dlq-mf-1', 'pending', { incrementRetry: true });
    expect(markStatusMock).toHaveBeenCalledWith('dlq-mf-2', 'replayed');
    expect(res.failed).toBe(1);
    expect(res.succeeded).toBe(1);
  });

  it('handles invalid JSON in DLQ entry gracefully', async () => {
    listPendingMock.mockResolvedValueOnce([
      {
        id: 'dlq-7',
        topic: 'payment.confirmed',
        message: 'invalid-non-json-content',
        retry_count: 0,
      },
    ]);

    const res = await orderConsumer.replayDeadLetters();

    expect(markStatusMock).toHaveBeenCalledWith('dlq-7', 'pending', { incrementRetry: true });
    expect(res.failed).toBe(1);
    expect(res.succeeded).toBe(0);
  });
});
