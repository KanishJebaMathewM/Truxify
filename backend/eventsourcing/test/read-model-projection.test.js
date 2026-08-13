import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { EventStore, EventStoreVersionConflictError } from '../event-store.js';
import { InMemoryDb, dbRow } from './in-memory-db.js';
import {
  ORDER_READ_MODEL_TABLE,
  ORDER_READ_MODEL_COLUMNS,
  assertOrderReadModelRow,
  OrderReadModelSchemaError,
} from '../../api/src/core/orders/read-model-schema.js';

const silentLogger = {
  info() {},
  warn() {},
  error() {},
};

/**
 * Minimal chainable supabase-like client that only serves the canonical
 * `orders_read_model` table. If a projection ever targets a different table
 * name (e.g. the obsolete `order_read_models`), `from()` returns undefined and
 * the test fails immediately.
 */
function createMockClient() {
  const orders = new Map();
  const drivers = new Map();
  const upsertedRows = [];
  const client = {
    orders,
    drivers,
    upsertedRows,
    from(name) {
      if (name === ORDER_READ_MODEL_TABLE) {
        const q = {
          filters: [],
          orderBy: null,
          limit: null,
          offset: null,
          upsert(items) {
            for (const item of items) {
              orders.set(item.order_id, item);
              upsertedRows.push(item);
            }
            return { data: items, error: null };
          },
          insert(items) {
            return q.upsert(items);
          },
          select() {
            return this;
          },
          eq(col, val) {
            this.filters.push([col, val]);
            return this;
          },
          order(col, dir) {
            this.orderBy = [col, dir];
            return this;
          },
          limit(n) {
            this.limit = n;
            return this;
          },
          offset(n) {
            this.offset = n;
            return this;
          },
          single() {
            const pair = this.filters.find(([col]) => col === 'order_id');
            const row = pair ? orders.get(pair[1]) ?? null : null;
            return Promise.resolve({ data: row, error: null });
          },
          then(resolve) {
            let rows = [...orders.values()];
            for (const [col, val] of this.filters) {
              if (col === 'payload->>status') {
                rows = rows.filter((r) => r.payload?.status === val);
              } else if (col === 'payload->>customerId') {
                rows = rows.filter((r) => r.payload?.customerId === val);
              } else if (col === 'order_id') {
                rows = rows.filter((r) => r.order_id === val);
              }
            }
            if (typeof this.limit === 'number') rows = rows.slice(0, this.limit);
            resolve({ data: rows, error: null });
          },
        };
        return q;
      }
      if (name === 'drivers_read_model') {
        return {
          upsert(items) {
            for (const item of items) drivers.set(item.driver_id, item);
            return { data: items, error: null };
          },
        };
      }
      return undefined;
    },
  };
  return client;
}

function createStore({ db, client }) {
  return new EventStore({ db, client, logger: silentLogger });
}

function assertCanonicalRow(row, orderId) {
  assert.ok(row, 'expected a read-model row');
  assert.deepEqual(
    Object.keys(row).sort(),
    [...ORDER_READ_MODEL_COLUMNS].sort(),
    'read-model row must contain exactly the canonical columns'
  );
  assert.equal(row.order_id, orderId);
  assert.equal(assertOrderReadModelRow(row), row, 'row must pass the schema drift guard');
}

describe('eventsourcing order read-model projection', () => {
  describe('_upsertOrderReadModel writes only canonical columns', () => {
    test('projects ORDER_CREATED with status/event_type/version', async () => {
      const orderId = 'order_proj_1';
      const db = new InMemoryDb({
        initialEvents: [
          dbRow({ id: 'e1', type: 'ORDER_CREATED', aggregateId: orderId, payload: { customerId: 'c1', amount: 10, pickup: 'p', dropoff: 'd' }, version: 1 }),
        ],
      });
      const client = createMockClient();
      const store = createStore({ db, client });

      await store.updateOrderReadModel({ aggregateId: orderId, type: 'ORDER_CREATED', version: 1, payload: {} });

      const row = client.orders.get(orderId);
      assertCanonicalRow(row, orderId);
      assert.equal(row.event_type, 'ORDER_CREATED');
      assert.equal(row.version, 1);
      assert.equal(row.payload.status, 'CREATED');
      assert.equal(row.status, 'created');
      assert.equal(row.timeline, null);
    });

    test('projects DRIVER_ASSIGNED status into the canonical status column', async () => {
      const orderId = 'order_proj_2';
      const db = new InMemoryDb({
        initialEvents: [
          dbRow({ id: 'e1', type: 'ORDER_CREATED', aggregateId: orderId, payload: { customerId: 'c1', amount: 10, pickup: 'p', dropoff: 'd' }, version: 1 }),
          dbRow({ id: 'e2', type: 'DRIVER_ASSIGNED', aggregateId: orderId, payload: { orderId, driverId: 'drv1', assignedAt: 't' }, version: 2 }),
        ],
      });
      const client = createMockClient();
      const store = createStore({ db, client });

      await store.updateOrderReadModel({ aggregateId: orderId, type: 'DRIVER_ASSIGNED', version: 2, payload: {} });

      const row = client.orders.get(orderId);
      assertCanonicalRow(row, orderId);
      assert.equal(row.payload.status, 'ASSIGNED');
      assert.equal(row.status, 'assigned');
      assert.equal(row.event_type, 'DRIVER_ASSIGNED');
      assert.equal(row.version, 2);
    });

    test('processing the same event twice keeps a single canonical row (upsert)', async () => {
      const orderId = 'order_proj_dup';
      const db = new InMemoryDb({
        initialEvents: [
          dbRow({ id: 'e1', type: 'ORDER_CREATED', aggregateId: orderId, payload: { customerId: 'c1', amount: 10, pickup: 'p', dropoff: 'd' }, version: 1 }),
        ],
      });
      const client = createMockClient();
      const store = createStore({ db, client });

      const event = { aggregateId: orderId, type: 'ORDER_CREATED', version: 1, payload: {} };
      await store.updateOrderReadModel(event);
      await store.updateOrderReadModel(event);

      assert.equal(client.orders.size, 1, 'duplicate event processing must not create duplicate rows');
      assertCanonicalRow(client.orders.get(orderId), orderId);
    });
  });

  describe('read-model queries', () => {
    test('getOrderReadModel returns the canonical row', async () => {
      const orderId = 'order_query_1';
      const db = new InMemoryDb({
        initialEvents: [
          dbRow({ id: 'e1', type: 'ORDER_CREATED', aggregateId: orderId, payload: { customerId: 'c1', amount: 10, pickup: 'p', dropoff: 'd' }, version: 1 }),
        ],
      });
      const client = createMockClient();
      const store = createStore({ db, client });
      await store.updateOrderReadModel({ aggregateId: orderId, type: 'ORDER_CREATED', version: 1, payload: {} });

      const row = await store.getOrderReadModel(orderId);
      assertCanonicalRow(row, orderId);
      assert.equal(row.payload.customerId, 'c1');
    });

    test('getOrderList filters on payload->>status and payload->>customerId', async () => {
      const db = new InMemoryDb();
      const client = createMockClient();
      const store = createStore({ db, client });

      await store._upsertOrderReadModel('order_a', { id: 'order_a', status: 'CREATED', customerId: 'c1', version: 1 }, 'ORDER_CREATED', 1);
      await store._upsertOrderReadModel('order_b', { id: 'order_b', status: 'CANCELLED', customerId: 'c1', version: 2 }, 'ORDER_CANCELLED', 2);
      await store._upsertOrderReadModel('order_c', { id: 'order_c', status: 'CREATED', customerId: 'c2', version: 1 }, 'ORDER_CREATED', 1);

      const createdForC1 = await store.getOrderList({ status: 'CREATED', customerId: 'c1' });
      assert.deepEqual(createdForC1.map((r) => r.order_id), ['order_a']);

      const allCreated = await store.getOrderList({ status: 'CREATED' });
      assert.deepEqual(allCreated.map((r) => r.order_id), ['order_a', 'order_c']);
    });
  });

  describe('rebuild/rebuildProjections', () => {
    test('rebuild writes canonical rows and is idempotent', async () => {
      const orderId = 'order_rebuild_1';
      const rows = [
        dbRow({ id: 'e1', type: 'ORDER_CREATED', aggregateId: orderId, payload: { customerId: 'c1', amount: 10, pickup: 'p', dropoff: 'd' }, version: 1 }),
        dbRow({ id: 'e2', type: 'ORDER_UPDATED', aggregateId: orderId, payload: { amount: 15 }, version: 2 }),
      ];
      const db = new InMemoryDb({ initialEvents: rows });
      const client = createMockClient();
      const store = createStore({ db, client });

      const first = await store.rebuildProjections(rows);
      const second = await store.rebuildProjections(rows);

      assert.equal(first.orderCount, 1);
      assert.equal(second.orderCount, 1);
      assert.equal(client.orders.size, 1, 'rebuild must be safe to run more than once');
      const row = client.orders.get(orderId);
      assertCanonicalRow(row, orderId);
      assert.equal(row.version, 2);
      assert.equal(row.payload.amount, 15);
      assert.equal(row.status, 'created');
    });
  });

  describe('duplicate event append', () => {
    test('appending the same version raises a conflict and does not corrupt the read model', async () => {
      const orderId = 'order_dup_append';
      const db = new InMemoryDb();
      const client = createMockClient();
      const store = createStore({ db, client });

      await store.appendEvent(orderId, { type: 'ORDER_CREATED', payload: { customerId: 'c', amount: 5, pickup: 'p', dropoff: 'd' } }, 0);
      await assert.rejects(
        () => store.appendEvent(orderId, { type: 'ORDER_CREATED', payload: { customerId: 'c', amount: 999, pickup: 'p', dropoff: 'd' } }, 0),
        (err) => err instanceof EventStoreVersionConflictError
      );

      await store.updateOrderReadModel({ aggregateId: orderId, type: 'ORDER_CREATED', version: 1, payload: {} });
      const row = client.orders.get(orderId);
      assertCanonicalRow(row, orderId);
      assert.equal(row.payload.amount, 5, 'read model reflects the committed event, not the rejected duplicate');
    });
  });

  describe('schema drift guard wiring', () => {
    test('projection rows always pass assertOrderReadModelRow', () => {
      const orderId = 'order_drift';
      const client = createMockClient();
      const store = createStore({ db: new InMemoryDb(), client });

      return store
        ._upsertOrderReadModel(orderId, { id: orderId, status: 'CREATED', version: 1 }, 'ORDER_CREATED', 1)
        .then(() => assertCanonicalRow(client.orders.get(orderId), orderId));
    });

    test('the drift guard rejects the legacy `data` column shape', () => {
      assert.throws(
        () =>
          assertOrderReadModelRow({
            order_id: 'o1',
            status: 'created',
            data: {},
            timeline: [],
            updated_at: 't',
          }),
        (err) => err instanceof OrderReadModelSchemaError
      );
    });
  });
});
