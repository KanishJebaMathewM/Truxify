/**
 * Unit tests for the single authoritative order read model
 * (backend/kafka/cqrs/order.read.model.js).
 *
 * Covers the read-model consolidation requirements of Issue #1:
 *   - applyEvent() applies the event ATOMICALLY with its idempotency record
 *     via the apply_order_event RPC
 *   - applyEvent() uses the real order id (never the event id)
 *   - duplicate/replayed events return false (no duplicate read-model effect)
 *   - the read model is read from `orders_read_model` (the single table)
 *
 * Run with:  npm test -- test/order.read.model.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORDER_ID = '9f8e7d6c-5b4a-4321-9876-0fedcba98765';

vi.mock('../../api/src/config/db.js', () => ({
  supabase: {
    from: vi.fn(),
  },
  supabaseAdmin: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

vi.mock('../../api/src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { OrderReadModel } from '../cqrs/order.read.model.js';
import { supabase, supabaseAdmin } from '../../api/src/config/db.js';

describe('OrderReadModel.applyEvent', () => {
  let client;
  let readModel;

  beforeEach(() => {
    vi.clearAllMocks();
    client = {
      rpc: vi.fn().mockResolvedValue({ data: { applied: true }, error: null }),
    };
    readModel = new OrderReadModel(client);
  });

  it('applies an event atomically through the apply_order_event RPC', async () => {
    const applied = await readModel.applyEvent({
      topic: 'order.created',
      eventId: 'evt-1234',
      orderId: ORDER_ID,
      eventType: 'ORDER_CREATED',
      payload: { id: ORDER_ID, status: 'pending' },
      version: 1,
    });

    expect(applied).toBe(true);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = client.rpc.mock.calls[0];
    expect(fn).toBe('apply_order_event');
    expect(args).toEqual({
      p_order_id: ORDER_ID,
      p_payload: { id: ORDER_ID, status: 'pending' },
      p_event_type: 'ORDER_CREATED',
      p_version: 1,
      p_topic: 'order.created',
      p_event_id: 'evt-1234',
    });
  });

  it('returns false for a duplicate/replayed event (no duplicate effect)', async () => {
    client.rpc.mockResolvedValue({ data: { applied: false }, error: null });
    const applied = await readModel.applyEvent({
      topic: 'order.created',
      eventId: 'evt-1234',
      orderId: ORDER_ID,
      eventType: 'ORDER_CREATED',
      payload: {},
    });
    expect(applied).toBe(false);
  });

  it('throws when the real order id (aggregate id) is missing', async () => {
    await expect(readModel.applyEvent({
      topic: 'order.created',
      eventId: 'evt-1234',
      orderId: null,
      eventType: 'ORDER_CREATED',
      payload: {},
    })).rejects.toThrow('orderId');
  });

  it('throws when the event id is missing', async () => {
    await expect(readModel.applyEvent({
      topic: 'order.created',
      eventId: null,
      orderId: ORDER_ID,
      eventType: 'ORDER_CREATED',
      payload: {},
    })).rejects.toThrow('eventId');
  });

  it('propagates database errors so the consumer can dead-letter/retry', async () => {
    client.rpc.mockResolvedValue({ data: null, error: { message: 'rpc exploded' } });
    await expect(readModel.applyEvent({
      topic: 'order.created',
      eventId: 'evt-1234',
      orderId: ORDER_ID,
      eventType: 'ORDER_CREATED',
      payload: {},
    })).rejects.toThrow('rpc exploded');
  });
});

describe('OrderReadModel reads', () => {
  let readModel;

  beforeEach(() => {
    vi.clearAllMocks();
    readModel = new OrderReadModel(supabaseAdmin);
  });

  it('reads the single authoritative read model from orders_read_model', async () => {
    const row = { order_id: ORDER_ID, payload: { status: 'pending' }, event_type: 'ORDER_CREATED', version: 1 };
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: row, error: null }),
    };
    supabase.from.mockReturnValue(chain);

    const result = await readModel.getOrderReadModel(ORDER_ID);

    expect(supabase.from).toHaveBeenCalledWith('orders_read_model');
    expect(chain.eq).toHaveBeenCalledWith('order_id', ORDER_ID);
    expect(result).toEqual(row);
  });

  it('filters order lists against the payload snapshot', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
    };
    const queryPromise = Promise.resolve({ data: [], error: null });
    chain.eq.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    chain.offset.mockReturnValue(chain);
    supabase.from.mockReturnValue(chain);
    chain.offset.mockReturnValue(queryPromise);

    await readModel.getAllOrdersReadModel({ status: 'pending', customerId: 'cust-1', limit: 10 });

    expect(supabase.from).toHaveBeenCalledWith('orders_read_model');
    expect(chain.eq).toHaveBeenCalledWith('payload->>status', 'pending');
    expect(chain.eq).toHaveBeenCalledWith('payload->>customer_id', 'cust-1');
  });
});
