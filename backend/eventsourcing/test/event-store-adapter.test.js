import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { EventStore, EventStoreVersionConflictError, EventStorePersistenceError } from '../event-store.js';
import { InMemoryDb, dbRow } from './in-memory-db.js';

const silentLogger = {
  info() {},
  warn() {},
  error() {},
};

/** Minimal chainable supabase-like client for the adapter's read models. */
function createMockClient() {
  const orders = new Map();
  const drivers = new Map();
  const client = {
    orders,
    drivers,
    from(name) {
      if (name === 'orders_read_model') {
        return {
          upsert: async (items) => {
            for (const item of items) orders.set(item.order_id, item);
            return { data: items, error: null };
          },
        };
      }
      if (name === 'drivers_read_model') {
        return {
          upsert: async (items) => {
            for (const item of items) drivers.set(item.driver_id, item);
            return { data: items, error: null };
          },
        };
      }
      return { upsert: async () => ({ data: [], error: null }) };
    },
  };
  return client;
}

describe('EventStore adapter', () => {
  test('CASE 11: package exposes ESM exports', async () => {
    assert.equal(typeof EventStore, 'function');
    assert.equal(typeof EventStoreVersionConflictError, 'function');
    assert.equal(typeof EventStorePersistenceError, 'function');
  });

  test('CASE 9: rebuildProjections reconstructs read models from persisted rows', async () => {
    const rows = [
      dbRow({ id: 'a1', type: 'ORDER_CREATED', aggregateId: 'order_rb_a', payload: { customerId: 'ca', amount: 10, pickup: 'p', dropoff: 'd' }, version: 1 }),
      dbRow({ id: 'a2', type: 'ORDER_UPDATED', aggregateId: 'order_rb_a', payload: { amount: 15 }, version: 2 }),
      dbRow({ id: 'b1', type: 'ORDER_CREATED', aggregateId: 'order_rb_b', payload: { customerId: 'cb', amount: 20, pickup: 'p', dropoff: 'd' }, version: 1 }),
      dbRow({ id: 'b2', type: 'DRIVER_ASSIGNED', aggregateId: 'order_rb_b', payload: { orderId: 'order_rb_b', driverId: 'drv_b', assignedAt: 't' }, version: 2 }),
    ];

    const db = new InMemoryDb({ initialEvents: rows });
    const client = createMockClient();
    const store = new EventStore({ db, client, logger: silentLogger });

    const result = await store.rebuildProjections(rows);

    assert.equal(result.aggregates, 2);
    assert.equal(result.orderCount, 2);
    assert.equal(result.driverCount, 1);
    assert.equal(result.eventCount, 4);

    // Read model payload equals the aggregate state, not a single event payload.
    const rmA = client.orders.get('order_rb_a');
    assert.equal(rmA.version, 2);
    assert.equal(rmA.payload.amount, 15);
    assert.equal(rmA.payload.status, 'CREATED');

    const rmB = client.orders.get('order_rb_b');
    assert.equal(rmB.payload.status, 'ASSIGNED');
    assert.equal(rmB.payload.driverId, 'drv_b');

    assert.equal(client.drivers.get('drv_b').order_id, 'order_rb_b');
  });

  test('rebuild honors a valid snapshot and skips covered events', async () => {
    const orderId = 'order_rb_snap_adapter';
    const rows = [
      dbRow({ id: 'e1', type: 'ORDER_CREATED', aggregateId: orderId, payload: { customerId: 'c', amount: 1, pickup: 'p', dropoff: 'd' }, version: 1 }),
      dbRow({ id: 'e2', type: 'ORDER_UPDATED', aggregateId: orderId, payload: { amount: 2 }, version: 2 }),
      dbRow({ id: 'e3', type: 'ORDER_UPDATED', aggregateId: orderId, payload: { amount: 3 }, version: 3 }),
    ];
    const db = new InMemoryDb({
      initialEvents: rows,
      initialSnapshots: [{
        aggregate_id: orderId,
        version: 2,
        state: { id: orderId, version: 2, customerId: 'c', amount: 999, status: 'CREATED' },
        snapshot_version: 1,
      }],
    });
    const client = createMockClient();
    const store = new EventStore({ db, client, logger: silentLogger });

    await store.rebuildProjections(rows);

    const rm = client.orders.get(orderId);
    assert.equal(rm.payload.amount, 3);
    assert.equal(rm.version, 3);
  });

  test('adapter appendEvent converts duplicate version into a typed conflict', async () => {
    const db = new InMemoryDb();
    const client = createMockClient();
    const store = new EventStore({ db, client, logger: silentLogger });

    await store.appendEvent('order_dup', { type: 'ORDER_CREATED', payload: { a: 1 } }, 0);
    await assert.rejects(
      () => store.appendEvent('order_dup', { type: 'ORDER_CREATED', payload: { a: 2 } }, 0),
      (err) => {
        assert.ok(err instanceof EventStoreVersionConflictError);
        assert.equal(err.code, 'EVENT_VERSION_CONFLICT');
        return true;
      }
    );
    assert.equal(db.rawRows('order_dup').length, 1);
  });
});
