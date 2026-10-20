import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventStoreCore } from '../event-sourcing-core.js';
import { InMemoryDb, dbRow } from './in-memory-db.js';

const aggregateId = 'order-cache';
const logger = { info() {}, error() {} };
const created = dbRow({ id: 'created', type: 'ORDER_CREATED', aggregateId,
  payload: { customerId: 'customer', price: 20 }, version: 1 });
const assigned = { type: 'DRIVER_ASSIGNED', payload: { driverId: 'driver' } };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const db = new InMemoryDb({ initialEvents: [created] });
  return { db, core: new EventStoreCore({ db, logger }) };
}
function blockFirstRead(db, method) {
  const original = db[method].bind(db);
  const entered = deferred(), release = deferred();
  let calls = 0;
  db[method] = async (id) => {
    const call = ++calls;
    const result = await original(id);
    const captured = result && !Array.isArray(result) ? structuredClone(result) : result;
    if (call === 1) { entered.resolve(); await release.promise; }
    return captured;
  };
  return { entered, release, calls: () => calls };
}

async function assertComplete(core, version = 2) {
  const state = await core.getAggregateState(aggregateId);
  assert.equal(state.customerId, 'customer');
  assert.equal(state.price, 20);
  assert.equal(state.driverId, 'driver');
  assert.equal(state.version, version);
}

test('cold append never installs a partial historical stream', async () => {
  const { core } = fixture();
  await core.appendEvent(aggregateId, assigned, 1);
  await assertComplete(core);
});

test('a read started before a committed append returns and caches the full new stream', async () => {
  const { core, db } = fixture();
  const gate = blockFirstRead(db, 'fetchEventStream');
  const pending = core.getEventStream(aggregateId);
  await gate.entered.promise;
  await core.appendEvent(aggregateId, assigned, 1);
  gate.release.resolve();
  assert.deepEqual((await pending).map(event => event.version), [1, 2]);
  await assertComplete(core);
  assert.equal(gate.calls(), 2);
});

test('warm append detects an intervening external version instead of caching a gap', async () => {
  const { core, db } = fixture();
  await core.getEventStream(aggregateId);
  await db.insertEvent(dbRow({ id: 'external', type: 'ORDER_UPDATED', aggregateId,
    payload: { price: 35 }, version: 2 }));
  await core.appendEvent(aggregateId, assigned, 2);
  const state = await core.getAggregateState(aggregateId);
  assert.equal(state.price, 35);
  assert.equal(state.customerId, 'customer');
  assert.equal(state.driverId, 'driver');
  assert.equal(state.version, 3);
});

test('contiguous warm append leaves previously returned streams unchanged', async () => {
  const { core } = fixture();
  const before = await core.getEventStream(aggregateId);
  await core.appendEvent(aggregateId, assigned, 1);
  assert.deepEqual(before.map(event => event.version), [1]);
  await assertComplete(core);
});

test('a failed append does not invalidate a complete cached stream', async () => {
  const { core, db } = fixture();
  const before = await core.getEventStream(aggregateId);
  db.insertEvent = async () => ({ error: new Error('write failed') });
  await assert.rejects(core.appendEvent(aggregateId, assigned, 1));
  assert.equal(await core.getEventStream(aggregateId), before);
});

for (const initialSnapshot of [null, { aggregate_id: aggregateId, version: 1,
  state: { customerId: 'customer', version: 1 }, snapshot_version: 1 }]) {
  test(`late ${initialSnapshot ? 'older' : 'absent'} snapshot read cannot replace a successful write`, async () => {
    const { core, db } = fixture();
    if (initialSnapshot) db._storeSnapshot(initialSnapshot);
    const gate = blockFirstRead(db, 'fetchSnapshot');
    const pending = core.getSnapshot(aggregateId);
    await gate.entered.promise;
    await core.takeSnapshot(aggregateId, { customerId: 'customer', version: 2 }, 2);
    gate.release.resolve();
    assert.equal((await pending).version, 2);
    assert.equal((await core.getSnapshot(aggregateId)).version, 2);
    assert.equal(gate.calls(), 1);
  });
}

test('failed snapshot writes leave the previous cache intact', async () => {
  const { core, db } = fixture();
  await core.takeSnapshot(aggregateId, { version: 1 }, 1);
  const before = await core.getSnapshot(aggregateId);
  db.upsertSnapshot = async () => ({ error: new Error('write failed') });
  await assert.rejects(core.takeSnapshot(aggregateId, { version: 2 }, 2));
  assert.equal(await core.getSnapshot(aggregateId), before);
});

for (const [method, getter, cache] of [
  ['fetchEventStream', 'getEventStream', 'eventStreams'],
  ['fetchSnapshot', 'getSnapshot', 'snapshots'],
]) {
  test(`${getter}: concurrent misses share one current database read`, async () => {
    const { core, db } = fixture();
    const gate = blockFirstRead(db, method);
    const pending = Array.from({ length: 40 }, () => core[getter](aggregateId));
    await gate.entered.promise;
    gate.release.resolve();
    const results = await Promise.all(pending);
    assert.equal(gate.calls(), 1);
    assert.ok(results.every(result => result === results[0]));
    assert.equal(await core[getter](aggregateId), results[0]);
    assert.equal(gate.calls(), 1);
  });

  for (const wholeCache of [false, true]) {
    test(`${getter}: ${wholeCache ? 'whole' : 'targeted'} clear fences an old load and preserves other keys`, async () => {
      const { core, db } = fixture();
      await core[getter]('other');
      const gate = blockFirstRead(db, method);
      const pending = core[getter](aggregateId);
      await gate.entered.promise;
      core.clearCache(wholeCache ? undefined : aggregateId);
      assert.equal(core[cache].has('other'), !wholeCache);
      if (method === 'fetchEventStream') {
        await db.insertEvent(dbRow({ id: 'update', type: 'ORDER_UPDATED', aggregateId,
          payload: { price: 35 }, version: 2 }));
      } else {
        await db.upsertSnapshot({ aggregate_id: aggregateId, version: 2,
          state: { version: 2 }, snapshot_version: 1 });
      }
      const current = await core[getter](aggregateId);
      gate.release.resolve();
      assert.equal(await pending, current);
      assert.equal(await core[getter](aggregateId), current);
      assert.equal(method === 'fetchEventStream' ? current.at(-1).version : current.version, 2);
      assert.equal(gate.calls(), 2);
    });
  }

  test(`${getter}: failed current load is not cached and the next call retries`, async () => {
    const { core, db } = fixture();
    const original = db[method].bind(db);
    let calls = 0;
    db[method] = async (id) => {
      calls += 1;
      if (calls === 1) throw new Error('read failed');
      return original(id);
    };
    if (getter === 'getEventStream') await assert.rejects(core[getter](aggregateId), /read failed/);
    else assert.equal(await core[getter](aggregateId), null);
    assert.equal(core[cache].has(aggregateId), false);
    await core[getter](aggregateId);
    assert.equal(calls, 2);
  });

  test(`${getter}: superseded successful load joins its pending replacement`, async () => {
    const { core, db } = fixture();
    const original = db[method].bind(db);
    const first = deferred(), second = deferred();
    let calls = 0;
    db[method] = async id => {
      const call = ++calls;
      const captured = await original(id);
      await (call === 1 ? first.promise : second.promise);
      return captured;
    };
    const old = core[getter](aggregateId);
    await new Promise(resolve => setImmediate(resolve));
    core.clearCache(aggregateId);
    const current = core[getter](aggregateId);
    await new Promise(resolve => setImmediate(resolve));
    first.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(core[cache].has(aggregateId), false);
    const shared = core[getter](aggregateId);
    second.resolve();
    assert.equal(await old, await current);
    assert.equal(await current, await shared);
    assert.equal(calls, 2);
  });

  test(`${getter}: a blocked aggregate does not serialize unrelated reads`, async () => {
    const { core, db } = fixture();
    const gate = blockFirstRead(db, method);
    const pending = core[getter](aggregateId);
    await gate.entered.promise;
    await core[getter]('unrelated');
    assert.equal(core[cache].has('unrelated'), true);
    assert.equal(core[cache].has(aggregateId), false);
    gate.release.resolve();
    await pending;
    assert.equal(gate.calls(), 2);
  });

  test(`${getter}: an old failed load cannot remove a newer pending load`, async () => {
    const { core, db } = fixture();
    const original = db[method].bind(db);
    const first = deferred(), second = deferred();
    let calls = 0;
    db[method] = async id => {
      calls += 1;
      await (calls === 1 ? first.promise : second.promise);
      return original(id);
    };
    const old = core[getter](aggregateId);
    const oldOutcome = old.then(value => ({ value }), error => ({ error }));
    await new Promise(resolve => setImmediate(resolve));
    core.clearCache(aggregateId);
    const current = core[getter](aggregateId);
    await new Promise(resolve => setImmediate(resolve));
    first.reject(new Error('old failed'));
    await oldOutcome;
    const shared = core[getter](aggregateId);
    second.resolve();
    assert.equal(await current, await shared);
    assert.equal(calls, 2);
  });
}
