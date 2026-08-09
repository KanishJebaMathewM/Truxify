import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { EventStoreCore, normalizeEventRow, applyEvent } from '../event-sourcing-core.js';
import { EventStoreVersionConflictError, EventStoreError } from '../errors.js';
import { InMemoryDb, dbRow } from './in-memory-db.js';

const silentLogger = {
  info() {},
  warn() {},
  error() {},
};

function createCore({ db, threshold = 50 } = {}) {
  return new EventStoreCore({
    db: db || new InMemoryDb(),
    logger: silentLogger,
    snapshotThreshold: threshold,
    uuid: () => `evt_${Math.random().toString(36).slice(2)}`,
    now: () => new Date('2026-08-08T00:00:00Z').toISOString(),
  });
}

/**
 * Appends a chain of events to an aggregate using optimistic concurrency.
 * By default the chain continues from the aggregate's current latest version.
 */
async function appendChain(core, aggregateId, typesAndPayloads, startVersion) {
  const stored = [];
  let expected = startVersion ?? (await core.getLatestVersion(aggregateId)) ?? 0;
  for (const { type, payload } of typesAndPayloads) {
    stored.push(await core.appendEvent(aggregateId, { type, payload }, expected));
    expected += 1;
  }
  return stored;
}

describe('EventStoreCore — event replay', () => {
  test('CASE 1: normal event replay produces correct state and version', async () => {
    const db = new InMemoryDb();
    const core = createCore({ db });
    const orderId = 'order_1';

    await appendChain(core, orderId, [
      { type: 'ORDER_CREATED', payload: { customerId: 'cust_1', amount: 100, pickup: 'A', dropoff: 'B' } },
      { type: 'ORDER_UPDATED', payload: { amount: 120 } },
      { type: 'DRIVER_ASSIGNED', payload: { orderId, driverId: 'drv_1', assignedAt: 't1' } },
    ]);

    const state = await core.getAggregateState(orderId);
    assert.equal(state.status, 'ASSIGNED');
    assert.equal(state.customerId, 'cust_1');
    assert.equal(state.amount, 120);
    assert.equal(state.driverId, 'drv_1');
    assert.equal(state.version, 3);
  });

  test('CASE 2: cold start (cleared cache) reconstructs identical state to warm cache', async () => {
    const db = new InMemoryDb();
    const core = createCore({ db });
    const orderId = 'order_cold';

    await appendChain(core, orderId, [
      { type: 'ORDER_CREATED', payload: { customerId: 'cust_x', amount: 10, pickup: 'P', dropoff: 'D' } },
      { type: 'ORDER_UPDATED', payload: { amount: 15 } },
      { type: 'DRIVER_ASSIGNED', payload: { orderId, driverId: 'drv_9' } },
      { type: 'ORDER_CANCELLED', payload: { orderId, reason: 'late' } },
    ]);

    const warmState = await core.getAggregateState(orderId);

    // Simulate application restart: in-memory caches are empty.
    core.clearCache();

    const coldState = await core.getAggregateState(orderId);
    assert.deepEqual(coldState, warmState);
    assert.equal(coldState.status, 'CANCELLED');
    assert.equal(coldState.reason, 'late');
    assert.equal(coldState.version, 4);
  });

  test('CASE 3: event normalization maps event_type->type and aggregate_id->aggregateId', async () => {
    const row = dbRow({
      id: 'evt_abc',
      type: 'ORDER_CREATED',
      aggregateId: 'order_norm',
      payload: { customerId: 'c', amount: 1, pickup: 'a', dropoff: 'b' },
      version: 1,
      timestamp: '2026-01-01T00:00:00Z',
    });
    const db = new InMemoryDb({ initialEvents: [row] });
    const core = createCore({ db });

    const events = await core.getEventStream('order_norm');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'ORDER_CREATED');
    assert.equal(events[0].aggregateId, 'order_norm');
    assert.equal(events[0].id, 'evt_abc');
    assert.equal(events[0].version, 1);
    assert.equal(events[0].payload.amount, 1);
    assert.equal(events[0].timestamp, '2026-01-01T00:00:00Z');

    // normalizeEventRow must also pass through already-domain-shaped events.
    const domain = normalizeEventRow({ id: 'x', type: 'ORDER_UPDATED', aggregateId: 'a', payload: {}, version: 2 });
    assert.deepEqual(domain, { id: 'x', type: 'ORDER_UPDATED', aggregateId: 'a', payload: {}, version: 2 });
  });

  test('CASE 10: historical DB-format events remain replayable', async () => {
    // Old rows use event_id/event_type/aggregate_id and may lack created_at.
    const db = new InMemoryDb({
      initialEvents: [
        dbRow({ id: 'e1', type: 'ORDER_CREATED', aggregateId: 'order_hist', payload: { customerId: 'c', amount: 5, pickup: 'p', dropoff: 'd' }, version: 1 }),
        dbRow({ id: 'e2', type: 'DRIVER_ASSIGNED', aggregateId: 'order_hist', payload: { orderId: 'order_hist', driverId: 'drv_h' }, version: 2 }),
      ],
    });
    const core = createCore({ db });

    const state = await core.getAggregateState('order_hist');
    assert.equal(state.version, 2);
    assert.equal(state.status, 'ASSIGNED');
    assert.equal(state.driverId, 'drv_h');
    assert.equal(state.customerId, 'c');
  });
});

describe('EventStoreCore — snapshots', () => {
  test('CASE 4: snapshot is loaded first and only newer events are replayed', async () => {
    const db = new InMemoryDb();
    const core = createCore({ db });
    const orderId = 'order_snap';

    // Events 1..10 all write `earlyFlag = true`. The snapshot at version 10
    // is authoritative and says `earlyFlag = false`. If replay incorrectly
    // starts from event 1 the flag would become true again.
    const early = Array.from({ length: 9 }, (_, i) => ({
      type: 'ORDER_UPDATED',
      payload: { earlyFlag: true, seq: i + 1 },
    }));
    await appendChain(core, orderId, [
      { type: 'ORDER_CREATED', payload: { customerId: 'c', amount: 1, pickup: 'p', dropoff: 'd' } },
      ...early,
    ]);

    const stateAt10 = await core.getAggregateState(orderId);
    assert.equal(stateAt10.version, 10);

    // Overwrite the snapshot with an authoritative state that differs from a
    // naive replay of events 1..10.
    const snapshotState = { ...stateAt10, earlyFlag: false };
    await core.takeSnapshot(orderId, snapshotState, 10);

    // Events 11..15 — only these may be replayed on top of the snapshot.
    await appendChain(core, orderId, [
      { type: 'ORDER_UPDATED', payload: { note: 'post-snapshot' } },
      { type: 'ORDER_UPDATED', payload: { note: 'post-snapshot-2' } },
      { type: 'ORDER_UPDATED', payload: { note: 'post-snapshot-3' } },
      { type: 'ORDER_UPDATED', payload: { note: 'post-snapshot-4' } },
      { type: 'ORDER_UPDATED', payload: { note: 'post-snapshot-5' } },
    ]);

    core.clearCache(orderId);
    const state = await core.getAggregateState(orderId);

    // Snapshot state is the base (its earlyFlag survives) and only 11..15
    // were applied on top.
    assert.equal(state.earlyFlag, false);
    assert.equal(state.note, 'post-snapshot-5');
    assert.equal(state.version, 15);

    const snapshot = await core.getSnapshot(orderId);
    assert.equal(snapshot.version, 10);
  });

  test('CASE 5: invalid snapshot falls back to full event replay', async () => {
    const orderId = 'order_invalid';
    const baseEvents = [
      dbRow({ id: 'e1', type: 'ORDER_CREATED', aggregateId: orderId, payload: { customerId: 'c', amount: 1, pickup: 'p', dropoff: 'd' }, version: 1 }),
      dbRow({ id: 'e2', type: 'ORDER_UPDATED', aggregateId: orderId, payload: { amount: 99 }, version: 2 }),
    ];

    for (const corrupt of [
      { version: 2, state: 'not-an-object' },
      { version: 'corrupt', state: { amount: 0 } },
      { version: 2, state: { amount: 0 }, snapshot_version: 999 },
      { version: 2, state: { amount: 0 }, snapshot_version: 'abc' },
    ]) {
      const db = new InMemoryDb({
        initialEvents: baseEvents,
        initialSnapshots: [{ aggregate_id: orderId, ...corrupt }],
      });
      const core = createCore({ db });

      const state = await core.getAggregateState(orderId);
      // Full replay — the corrupt snapshot is ignored, state is intact.
      assert.equal(state.amount, 99);
      assert.equal(state.version, 2);
      assert.equal(state.status, 'CREATED');
    }
  });

  test('CASE 12: snapshot + newer events reconstruct correctly after restart', async () => {
    const db = new InMemoryDb();
    const core = createCore({ db });
    const orderId = 'order_restart';

    await appendChain(core, orderId, [
      { type: 'ORDER_CREATED', payload: { customerId: 'c', amount: 10, pickup: 'p', dropoff: 'd' } },
      { type: 'ORDER_UPDATED', payload: { amount: 20 } },
      { type: 'ORDER_UPDATED', payload: { amount: 30 } },
      { type: 'ORDER_UPDATED', payload: { amount: 40 } },
      { type: 'ORDER_UPDATED', payload: { amount: 50 } },
      { type: 'ORDER_UPDATED', payload: { amount: 60 } },
    ]);
    const stateAt6 = await core.getAggregateState(orderId);
    await core.takeSnapshot(orderId, stateAt6, 6);

    // More events arrive after the snapshot.
    await appendChain(core, orderId, [
      { type: 'ORDER_UPDATED', payload: { amount: 70 } },
      { type: 'DRIVER_ASSIGNED', payload: { orderId, driverId: 'drv_r' } },
    ]);

    // Shutdown: wipe all in-memory state.
    core.clearCache();

    const restarted = await core.getAggregateState(orderId);
    assert.equal(restarted.amount, 70);
    assert.equal(restarted.driverId, 'drv_r');
    assert.equal(restarted.status, 'ASSIGNED');
    assert.equal(restarted.version, 8);
  });

  test('snapshot threshold policy only snapshots after N new events', async () => {
    const db = new InMemoryDb();
    const core = createCore({ db, threshold: 5 });
    const orderId = 'order_thresh';

    await appendChain(core, orderId, [
      { type: 'ORDER_CREATED', payload: { customerId: 'c', amount: 1, pickup: 'p', dropoff: 'd' } },
      { type: 'ORDER_UPDATED', payload: { amount: 2 } },
      { type: 'ORDER_UPDATED', payload: { amount: 3 } },
      { type: 'ORDER_UPDATED', payload: { amount: 4 } },
    ]);
    // 4 events, threshold 5 -> no snapshot yet.
    await core.checkSnapshot(orderId);
    assert.equal(await core.getSnapshot(orderId), null);

    await appendChain(core, orderId, [
      { type: 'ORDER_UPDATED', payload: { amount: 5 } },
    ]);
    await core.checkSnapshot(orderId);
    const snap = await core.getSnapshot(orderId);
    assert.equal(snap.version, 5);
  });
});

describe('EventStoreCore — optimistic concurrency', () => {
  test('CASE 6: two concurrent commands never produce duplicate versions', async () => {
    const db = new InMemoryDb();
    const core = createCore({ db });
    const orderId = 'order_race';

    await appendChain(core, orderId, [
      { type: 'ORDER_CREATED', payload: { customerId: 'c', amount: 1, pickup: 'p', dropoff: 'd' } },
      { type: 'ORDER_UPDATED', payload: { amount: 2 } },
      { type: 'ORDER_UPDATED', payload: { amount: 3 } },
      { type: 'ORDER_UPDATED', payload: { amount: 4 } },
      { type: 'ORDER_UPDATED', payload: { amount: 5 } },
    ]);
    assert.equal((await core.getLatestVersion(orderId)), 5);

    // Simulate the production race: BOTH requests read version 5 before either
    // one inserts. The database uniqueness (mirrored by InMemoryDb) lets only
    // one of them commit version 6.
    const originalFetch = db.fetchLatestVersion.bind(db);
    let reads = 0;
    let releaseGate;
    const gate = new Promise((resolve) => { releaseGate = resolve; });
    db.fetchLatestVersion = async (aggregateId) => {
      const captured = await originalFetch(aggregateId); // both capture 5
      reads += 1;
      if (reads >= 2) releaseGate();
      await gate;
      return captured;
    };

    const results = await Promise.allSettled([
      core.appendEvent(orderId, { type: 'UPDATE_ORDER_EVENT', payload: { note: 'A' } }, 5),
      core.appendEvent(orderId, { type: 'UPDATE_ORDER_EVENT', payload: { note: 'B' } }, 5),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const conflicts = results.filter((r) => r.status === 'rejected');
    assert.equal(successes.length, 1);
    assert.equal(conflicts.length, 1);
    assert.ok(conflicts[0].reason instanceof EventStoreVersionConflictError);
    assert.equal(conflicts[0].reason.code, 'EVENT_VERSION_CONFLICT');

    // Exactly one version 6 event exists.
    assert.equal(db.hasVersion(orderId, 6), true);
    assert.equal(db.rawRows(orderId).filter((r) => r.version === 6).length, 1);
    assert.equal(db.rawRows(orderId).length, 6);
  });

  test('CASE 7: duplicate version is rejected as a typed domain error', async () => {
    const db = new InMemoryDb();
    const core = createCore({ db });
    const orderId = 'order_dup';

    const first = await core.appendEvent(orderId, { type: 'ORDER_CREATED', payload: { a: 1 } }, 0);
    assert.equal(first.version, 1);

    // Second write that claims version 1 again must be a typed conflict.
    await assert.rejects(
      () => core.appendEvent(orderId, { type: 'ORDER_CREATED', payload: { a: 2 } }, 0),
      (err) => {
        assert.ok(err instanceof EventStoreVersionConflictError);
        assert.equal(err.code, 'EVENT_VERSION_CONFLICT');
        return true;
      }
    );

    // A mismatched expected version (stale read) is also a typed conflict.
    await assert.rejects(
      () => core.appendEvent(orderId, { type: 'ORDER_UPDATED', payload: { a: 3 } }, 5),
      (err) => {
        assert.ok(err instanceof EventStoreVersionConflictError);
        assert.equal(err.expectedVersion, 5);
        assert.equal(err.currentVersion, 1);
        return true;
      }
    );

    assert.equal(db.rawRows(orderId).length, 1);
  });

  test('CASE 8: different aggregates may use the same version', async () => {
    const db = new InMemoryDb();
    const core = createCore({ db });

    await core.appendEvent('order_A', { type: 'ORDER_CREATED', payload: { customerId: 'a', amount: 1, pickup: 'p', dropoff: 'd' } }, 0);
    await core.appendEvent('order_B', { type: 'ORDER_CREATED', payload: { customerId: 'b', amount: 2, pickup: 'p', dropoff: 'd' } }, 0);

    assert.equal(db.rawRows('order_A').length, 1);
    assert.equal(db.rawRows('order_B').length, 1);
    assert.equal(db.hasVersion('order_A', 1), true);
    assert.equal(db.hasVersion('order_B', 1), true);

    const stateA = await core.getAggregateState('order_A');
    const stateB = await core.getAggregateState('order_B');
    assert.equal(stateA.version, 1);
    assert.equal(stateB.version, 1);
  });

  test('expected version chaining stores consecutive versions', async () => {
    const db = new InMemoryDb();
    const core = createCore({ db });
    const orderId = 'order_chain';

    const events = await appendChain(core, orderId, [
      { type: 'ORDER_CREATED', payload: { customerId: 'c', amount: 1, pickup: 'p', dropoff: 'd' } },
      { type: 'ORDER_UPDATED', payload: { amount: 2 } },
      { type: 'ORDER_UPDATED', payload: { amount: 3 } },
    ]);
    assert.deepEqual(events.map((e) => e.version), [1, 2, 3]);
    assert.deepEqual(db.rawRows(orderId).map((r) => r.version), [1, 2, 3]);
  });
});

describe('EventStoreCore — rebuild from persisted rows', () => {
  test('CASE 9: rebuild reconstructs correct read-model state per aggregate', async () => {
    const rows = [
      dbRow({ id: 'a1', type: 'ORDER_CREATED', aggregateId: 'order_rb_a', payload: { customerId: 'ca', amount: 10, pickup: 'p', dropoff: 'd' }, version: 1 }),
      dbRow({ id: 'a2', type: 'ORDER_UPDATED', aggregateId: 'order_rb_a', payload: { amount: 15 }, version: 2 }),
      dbRow({ id: 'b1', type: 'ORDER_CREATED', aggregateId: 'order_rb_b', payload: { customerId: 'cb', amount: 20, pickup: 'p', dropoff: 'd' }, version: 1 }),
      dbRow({ id: 'b2', type: 'DRIVER_ASSIGNED', aggregateId: 'order_rb_b', payload: { orderId: 'order_rb_b', driverId: 'drv_b' }, version: 2 }),
    ];
    const db = new InMemoryDb({ initialEvents: rows });
    const core = createCore({ db });

    const stateA = await core.rebuildFromRows('order_rb_a', rows.filter((r) => r.aggregate_id === 'order_rb_a'));
    const stateB = await core.rebuildFromRows('order_rb_b', rows.filter((r) => r.aggregate_id === 'order_rb_b'));

    assert.equal(stateA.version, 2);
    assert.equal(stateA.amount, 15);
    assert.equal(stateB.version, 2);
    assert.equal(stateB.status, 'ASSIGNED');
    assert.equal(stateB.driverId, 'drv_b');
  });

  test('rebuild skips events already covered by a valid snapshot', async () => {
    const orderId = 'order_rb_snap';
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
        state: { id: orderId, version: 2, customerId: 'c', amount: 999 },
        snapshot_version: 1,
      }],
    });
    const core = createCore({ db });

    const state = await core.rebuildFromRows(orderId, rows);
    // Event 3 only is applied on top of the snapshot state.
    assert.equal(state.amount, 3);
    assert.equal(state.version, 3);
  });
});

describe('EventStoreCore — errors', () => {
  test('persistence errors are translated to typed errors', async () => {
    const db = new InMemoryDb();
    db.insertEvent = async () => ({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_event_store_aggregate_version"' } });
    const core = createCore({ db });

    await assert.rejects(
      () => core.appendEvent('order_err', { type: 'ORDER_CREATED', payload: {} }, 0),
      (err) => {
        assert.ok(err instanceof EventStoreVersionConflictError);
        assert.equal(err.code, 'EVENT_VERSION_CONFLICT');
        return true;
      }
    );
  });

  test('missing aggregate returns null (not an error)', async () => {
    const core = createCore();
    assert.equal(await core.getAggregateState('does_not_exist'), null);
    assert.equal(await core.getLatestVersion('does_not_exist'), null);
  });

  test('appendEvent validates inputs with typed errors', async () => {
    const core = createCore();
    await assert.rejects(() => core.appendEvent(null, { type: 'ORDER_CREATED' }, 0), EventStoreError);
    await assert.rejects(() => core.appendEvent('a', {}, 0), EventStoreError);
    await assert.rejects(() => core.appendEvent('a', { type: '' }, 0), EventStoreError);
  });
});

describe('applyEvent — pure reducer', () => {
  test('ORDER_CREATED / ORDER_UPDATED / ORDER_CANCELLED / DRIVER_ASSIGNED', () => {
    let s = { id: 'x', version: 0 };
    s = applyEvent(s, { type: 'ORDER_CREATED', payload: { customerId: 'c' }, version: 1 });
    assert.equal(s.status, 'CREATED');
    assert.equal(s.customerId, 'c');
    s = applyEvent(s, { type: 'ORDER_UPDATED', payload: { amount: 5 }, version: 2 });
    assert.equal(s.amount, 5);
    s = applyEvent(s, { type: 'DRIVER_ASSIGNED', payload: { driverId: 'd' }, version: 3 });
    assert.equal(s.status, 'ASSIGNED');
    assert.equal(s.driverId, 'd');
    s = applyEvent(s, { type: 'ORDER_CANCELLED', payload: { reason: 'r', cancelledAt: 't' }, version: 4 });
    assert.equal(s.status, 'CANCELLED');
    assert.equal(s.reason, 'r');
    assert.equal(s.version, 4);
  });
});
