/**
 * Unit tests for backend/kafka/relay/outboxRelay.js
 *
 * Coverage:
 *   - a claimed row is published to Kafka and then marked published
 *   - a publish failure is recorded via fail_order_outbox_event (retry)
 *   - an empty claim produces a no-op cycle
 *   - buildKafkaMessage keeps the canonical metadata + payload shape
 *   - markPublished returns false when another relay already marked the row
 *
 * Run with:  npm test -- test/outboxRelay.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/src/config/db.js', () => ({
  supabase: null,
  supabaseAdmin: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ count: 0, error: null })),
      })),
    })),
  },
}));

vi.mock('../../api/src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../config/kafka.config.js', () => ({
  default: {
    publishEvent: vi.fn(),
    disconnect: vi.fn(),
  },
}));

vi.mock('../../api/src/core/telemetry/ContextPropagator.js', () => ({
  ContextPropagator: {
    injectIntoEventPayload: (event) => event,
  },
}));

vi.mock('../../api/src/core/telemetry/WorkerTracer.js', () => ({
  WorkerTracer: {
    wrapIntervalWorker: (_name, handler) => handler,
  },
}));

import {
  processOutboxCycle,
  buildKafkaMessage,
  claimBatch,
  markPublished,
  failEvent,
} from '../relay/outboxRelay.js';
import { supabaseAdmin } from '../../api/src/config/db.js';
import kafka from '../config/kafka.config.js';

const row = {
  id: 'row-1',
  event_id: 'evt-001',
  order_id: 'ord-001',
  order_display_id: 'ORD-001',
  event_type: 'ORDER_CREATED',
  topic: 'order.created',
  payload: { orderId: 'ord-001', order_display_id: 'ORD-001', status: 'pending' },
  metadata: {
    eventId: 'evt-001',
    eventType: 'ORDER_CREATED',
    source: 'order-service',
    category: 'domain',
    version: '1.0',
    timestamp: '2026-08-12T00:00:00.000Z',
  },
};

describe('OutboxRelay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kafka.publishEvent.mockResolvedValue({});
  });

  it('publishes a claimed row to Kafka and then marks it published', async () => {
    supabaseAdmin.rpc
      .mockResolvedValueOnce({ data: [row], error: null }) // claim_order_outbox_events
      .mockResolvedValueOnce({ data: true, error: null }); // mark_order_outbox_published

    const summary = await processOutboxCycle();

    expect(kafka.publishEvent).toHaveBeenCalledWith(
      'order.created',
      expect.objectContaining({
        metadata: row.metadata,
        payload: row.payload,
      }),
      'evt-001',
    );

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('mark_order_outbox_published', {
      p_event_id: 'evt-001',
    });
    expect(summary).toEqual({ claimed: 1, published: 1, failed: 0 });
  });

  it('records a publish failure so the row retries with backoff', async () => {
    supabaseAdmin.rpc
      .mockResolvedValueOnce({ data: [row], error: null }) // claim
      .mockResolvedValueOnce({ data: true, error: null }); // fail_order_outbox_event

    kafka.publishEvent.mockRejectedValue(new Error('broker unreachable'));

    const summary = await processOutboxCycle();

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('fail_order_outbox_event', {
      p_event_id: 'evt-001',
      p_error: 'broker unreachable',
    });
    expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith('mark_order_outbox_published', {
      p_event_id: 'evt-001',
    });
    expect(summary).toEqual({ claimed: 1, published: 0, failed: 1 });
  });

  it('returns a no-op summary when no events are claimable', async () => {
    supabaseAdmin.rpc.mockResolvedValueOnce({ data: [], error: null });

    const summary = await processOutboxCycle();

    expect(summary).toEqual({ claimed: 0, published: 0, failed: 0 });
    expect(kafka.publishEvent).not.toHaveBeenCalled();
  });

  it('buildKafkaMessage keeps the canonical metadata + payload shape', () => {
    const message = buildKafkaMessage(row);
    expect(message.metadata).toEqual(row.metadata);
    expect(message.payload).toEqual(row.payload);
  });

  it('claimBatch delegates to the claim RPC with lease/max-attempts params', async () => {
    supabaseAdmin.rpc.mockResolvedValueOnce({ data: [row], error: null });

    const claimed = await claimBatch({
      limit: 50,
      instanceId: 'relay-1',
      leaseMs: 30000,
      maxAttempts: 10,
    });

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('claim_order_outbox_events', {
      p_limit: 50,
      p_instance_id: 'relay-1',
      p_lease_seconds: 30,
      p_max_attempts: 10,
    });
    expect(claimed).toEqual([row]);
  });

  it('markPublished returns false when the row was already marked published', async () => {
    supabaseAdmin.rpc.mockResolvedValueOnce({ data: false, error: null });

    const marked = await markPublished('evt-001');

    expect(marked).toBe(false);
  });

  it('failEvent returns false when the failure cannot be recorded', async () => {
    supabaseAdmin.rpc.mockResolvedValueOnce({ data: null, error: new Error('RLS denied') });

    const recorded = await failEvent('evt-001', new Error('boom'));

    expect(recorded).toBe(false);
  });
});
