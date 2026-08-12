/**
 * Unit tests for backend/kafka/cqrs/order.read.model.js
 *
 * The Kafka CQRS projection and the eventsourcing projection share the
 * canonical `orders_read_model` table (see the unified schema migration
 * 20260812000000_unify_order_read_model_schema.sql and the schema module
 * backend/api/src/core/orders/read-model-schema.js). This test verifies the
 * Kafka writer:
 *   - upserts only canonical columns (never the legacy `data` column),
 *   - derives event_type / version from the snapshot timeline,
 *   - writes the normalized lowercase status column,
 *   - queries ORDER_READ_MODEL_TABLE everywhere (no `order_read_models`),
 *   - filters the list query on payload->customer_id / payload->driver_id.
 *
 * Run with:  npm test -- test/order.read.model.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ORDER_READ_MODEL_COLUMNS, ORDER_READ_MODEL_TABLE } from '../../api/src/core/orders/read-model-schema.js';

/** Records every supabase interaction so tests can assert table/row shapes. */
const state = {
  rows: new Map(),
  tables: [],
  eqCalls: [],
  lastUpsert: null,
};

function makeQuery(table) {
  const q = {
    filters: [],
    selectArgs: null,
    upsert(items, opts) {
      state.lastUpsert = { table, rows: items, opts };
      for (const item of items) state.rows.set(item.order_id, item);
      return {
        select() {
          return {
            single: () => Promise.resolve({ data: items[0] ?? null, error: null }),
          };
        },
      };
    },
    select(...args) {
      q.selectArgs = args;
      return q;
    },
    eq(col, val) {
      q.filters.push([col, val]);
      state.eqCalls.push([table, col, val]);
      return q;
    },
    gte(col, val) {
      q.filters.push([col, val]);
      return q;
    },
    lte(col, val) {
      q.filters.push([col, val]);
      return q;
    },
    order() {
      return q;
    },
    limit(n) {
      q.limit = n;
      return q;
    },
    offset(n) {
      q.offset = n;
      return q;
    },
    single() {
      const pair = q.filters.find(([col]) => col === 'order_id');
      const row = pair ? state.rows.get(pair[1]) ?? null : null;
      return Promise.resolve({ data: row, error: null });
    },
    then(resolve) {
      let result = [...state.rows.values()];
      for (const [col, val] of q.filters) {
        if (col === 'status') result = result.filter((r) => r.status === val);
        else if (col === 'order_id') result = result.filter((r) => r.order_id === val);
        else if (col === 'payload->customer_id') result = result.filter((r) => r.payload?.customer_id === val);
        else if (col === 'payload->driver_id') result = result.filter((r) => r.payload?.driver_id === val);
      }
      if (q.selectArgs && q.selectArgs[1]?.count) {
        resolve({ count: result.length, error: null });
      } else {
        resolve({ data: result, error: null });
      }
    },
  };
  return q;
}

vi.mock('../../api/src/config/db.js', () => ({
  supabase: {
    from: vi.fn((table) => {
      state.tables.push(table);
      return makeQuery(table);
    }),
  },
  supabaseAdmin: {
    from: vi.fn((table) => {
      state.tables.push(table);
      return makeQuery(table);
    }),
  },
}));

vi.mock('../../api/src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../repositories/event.repository.js', () => ({
  default: {
    getSnapshot: vi.fn(),
  },
}));

import orderReadModel from '../cqrs/order.read.model.js';
import eventRepository from '../repositories/event.repository.js';

describe('OrderReadModel.updateReadModel (canonical projection)', () => {
  beforeEach(() => {
    state.rows.clear();
    state.tables.length = 0;
    state.eqCalls.length = 0;
    state.lastUpsert = null;
    orderReadModel.clearCache();
    vi.clearAllMocks();
  });

  it('upserts a canonical row derived from the snapshot', async () => {
    const timeline = [
      { eventId: 'e1', type: 'ORDER_CREATED', timestamp: 't1', data: { customer_id: 'c1' } },
      { eventId: 'e2', type: 'DRIVER_ASSIGNED', timestamp: 't2', data: { driver_id: 'd1' } },
    ];
    const snapshot = {
      orderId: 'order_1',
      status: 'assigned',
      data: { customer_id: 'c1', driver: { driver_id: 'd1' } },
      timeline,
    };

    await orderReadModel.updateReadModel('order_1', snapshot);

    expect(state.tables).toContain(ORDER_READ_MODEL_TABLE);
    const row = state.lastUpsert.rows[0];
    expect(Object.keys(row).sort()).toEqual([...ORDER_READ_MODEL_COLUMNS].sort());
    expect(row.data).toBeUndefined();
    expect(row.order_id).toBe('order_1');
    expect(row.payload).toBe(snapshot.data);
    expect(row.status).toBe('assigned');
    expect(row.event_type).toBe('DRIVER_ASSIGNED');
    expect(row.version).toBe(2);
    expect(row.timeline).toBe(timeline);
    expect(state.lastUpsert.opts.onConflict).toBe('order_id');
  });

  it('derives status/event_type/version for a snapshot without them', async () => {
    const snapshot = {
      orderId: 'order_2',
      data: { customer_id: 'c2' },
      timeline: [],
    };

    await orderReadModel.updateReadModel('order_2', snapshot);

    const row = state.lastUpsert.rows[0];
    expect(row.status).toBe('created');
    expect(row.event_type).toBeNull();
    expect(row.version).toBeNull();
    expect(row.timeline).toEqual([]);
  });

  it('writes rows that pass assertOrderReadModelRow (no legacy `data` column)', async () => {
    const { assertOrderReadModelRow } = await import('../../api/src/core/orders/read-model-schema.js');
    const snapshot = { orderId: 'order_3', status: 'completed', data: { x: 1 }, timeline: [{ eventId: 'e1', type: 'TRIP_COMPLETED' }] };

    await orderReadModel.updateReadModel('order_3', snapshot);

    expect(() => assertOrderReadModelRow(state.lastUpsert.rows[0])).not.toThrow();
  });

  it('buildReadModel re-projects the snapshot through updateReadModel', async () => {
    const snapshot = { orderId: 'order_4', status: 'paid', data: { amount: 10 }, timeline: [{ eventId: 'e1', type: 'PAYMENT_CONFIRMED' }] };
    eventRepository.getSnapshot.mockResolvedValue(snapshot);

    const result = await orderReadModel.buildReadModel('order_4');

    expect(result).toBe(snapshot);
    const row = state.lastUpsert.rows[0];
    expect(row.order_id).toBe('order_4');
    expect(row.status).toBe('paid');
    expect(row.event_type).toBe('PAYMENT_CONFIRMED');
  });
});

describe('OrderReadModel queries use ORDER_READ_MODEL_TABLE', () => {
  beforeEach(() => {
    state.rows.clear();
    state.tables.length = 0;
    state.eqCalls.length = 0;
    state.lastUpsert = null;
    orderReadModel.clearCache();
    vi.clearAllMocks();
  });

  async function seed(orderId, status, payload) {
    await orderReadModel.updateReadModel(orderId, {
      orderId,
      status,
      data: payload,
      timeline: [{ eventId: `e-${orderId}`, type: 'ORDER_CREATED' }],
    });
  }

  it('getAllOrdersReadModel queries the canonical table with payload filters', async () => {
    await seed('order_a', 'created', { customer_id: 'c1' });
    await seed('order_b', 'created', { customer_id: 'c2' });
    await seed('order_c', 'in_transit', { customer_id: 'c1', driver_id: 'd9' });

    const list = await orderReadModel.getAllOrdersReadModel({
      status: 'created',
      customerId: 'c1',
      limit: 10,
      offset: 0,
    });

    expect(state.tables).toContain(ORDER_READ_MODEL_TABLE);
    expect(state.eqCalls).toEqual(
      expect.arrayContaining([
        [ORDER_READ_MODEL_TABLE, 'status', 'created'],
        [ORDER_READ_MODEL_TABLE, 'payload->customer_id', 'c1'],
      ])
    );
    expect(list.map((r) => r.order_id)).toEqual(['order_a']);
  });

  it('getOrderStats counts by lowercase status on the canonical table', async () => {
    await seed('order_s1', 'created', {});
    await seed('order_s2', 'created', {});
    await seed('order_s3', 'completed', {});

    const stats = await orderReadModel.getOrderStats();

    expect(state.tables).toEqual(
      expect.arrayContaining([ORDER_READ_MODEL_TABLE, ORDER_READ_MODEL_TABLE, ORDER_READ_MODEL_TABLE])
    );
    expect(stats.created).toBe(2);
    expect(stats.completed).toBe(1);
    expect(stats.settled).toBe(0);
  });

  it('getOrderReadModel reads the canonical row (and caches it)', async () => {
    await seed('order_r1', 'created', { customer_id: 'c1' });

    const row = await orderReadModel.getOrderReadModel('order_r1');

    expect(state.tables).toContain(ORDER_READ_MODEL_TABLE);
    expect(row.order_id).toBe('order_r1');
    expect(row.payload.customer_id).toBe('c1');
    expect(row.data).toBeUndefined();
  });
});
