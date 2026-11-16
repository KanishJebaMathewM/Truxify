import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import GlobalStore from '../GlobalStore.js';

describe('GlobalStore get/set/update', () => {
  test('get(key) and get() whole-state', () => {
    const s = new GlobalStore({ user: 'driver-1', balance: 100 });
    assert.equal(s.get('user'), 'driver-1');
    assert.deepEqual(s.get(), { user: 'driver-1', balance: 100 });
  });

  test('set() emits stateChanged with old/new and notifies key listeners', () => {
    const s = new GlobalStore({ balance: 100 });
    let evt = null;
    let notified = null;
    s.on('stateChanged', (e) => (evt = e));
    s.subscribe('balance', (v) => (notified = v));
    s.set('balance', 250);
    assert.deepEqual(evt, { key: 'balance', oldValue: 100, newValue: 250 });
    assert.equal(notified, 250);
  });

  test('unsubscribe stops notifications', () => {
    const s = new GlobalStore({});
    let calls = 0;
    const off = s.subscribe('k', () => calls++);
    s.set('k', 1);
    off();
    s.set('k', 2);
    assert.equal(calls, 1);
  });

  test('update() merges and emits stateUpdated', () => {
    const s = new GlobalStore({ a: 1, b: 2 });
    let evt = null;
    s.on('stateUpdated', (e) => (evt = e));
    s.update({ b: 20, c: 30 });
    assert.deepEqual(s.get(), { a: 1, b: 20, c: 30 });
    assert.deepEqual(evt.oldState, { a: 1, b: 2 });
  });

  test('isTracking=false disables history and events', () => {
    const s = new GlobalStore({ a: 1 });
    s.isTracking = false;
    let fired = false;
    s.on('stateChanged', () => (fired = true));
    s.set('a', 2);
    assert.equal(s.get('a'), 2);
    assert.equal(fired, false);
    assert.equal(s.history.length, 0);
  });
});

describe('GlobalStore undo/redo', () => {
  test('undo restores the previous state; redo reapplies', () => {
    const s = new GlobalStore({ v: 0 });
    s.set('v', 1);
    s.set('v', 2);
    assert.equal(s.canUndo(), true);
    assert.equal(s.undo(), true);
    assert.equal(s.get('v'), 1);
    assert.equal(s.redo(), true);
    assert.equal(s.get('v'), 2);
  });

  test('undo at the boundary returns false; redo likewise', () => {
    const s = new GlobalStore({ v: 0 });
    s.saveHistory(); // baseline — without it the initial state is not recorded
    s.set('v', 1);
    s.undo();
    assert.equal(s.undo(), false, 'nothing left to undo');
    assert.equal(s.get('v'), 0);
    s.redo();
    assert.equal(s.redo(), false, 'nothing to redo past the tip');
  });

  test('a new set after undo truncates the redo branch', () => {
    const s = new GlobalStore({ v: 0 });
    s.set('v', 1);
    s.set('v', 2);
    s.undo();
    s.set('v', 99);
    assert.equal(s.canRedo(), false, 'redo branch discarded');
    assert.equal(s.get('v'), 99);
  });

  test('history is capped at maxHistory', () => {
    const s = new GlobalStore({ v: 0 });
    s.maxHistory = 5;
    for (let i = 1; i <= 10; i++) s.set('v', i);
    assert.ok(s.history.length <= 5);
    // oldest reachable state is v=6, not v=0
    while (s.canUndo()) s.undo();
    assert.equal(s.get('v'), 6);
  });
});

describe('GlobalStore undo off-by-one regression', () => {
  test('undo from the tip restores the IMMEDIATE previous state (pre-fix it skipped it)', () => {
    const s = new GlobalStore({ v: 0 });
    s.set('v', 1);
    s.set('v', 2);
    // pre-fix: set() recorded the PRE-state, so one undo jumped v2 → v0,
    // skipping v1 entirely; redo could never restore v2.
    assert.equal(s.undo(), true);
    assert.equal(s.get('v'), 1, 'undo must land on v1, not skip to v0');
    assert.equal(s.redo(), true);
    assert.equal(s.get('v'), 2, 'redo must restore the undone tip state');
  });
});

describe('GlobalStore snapshots', () => {
  test('snapshot/restore round-trips deeply and emits snapshotRestored', () => {
    const s = new GlobalStore({ nested: { list: [1, 2] } });
    const snap = s.createSnapshot();
    s.set('nested', { list: [9] });
    let evt = null;
    s.on('snapshotRestored', (e) => (evt = e));
    s.restoreSnapshot(snap);
    assert.deepEqual(s.get('nested'), { list: [1, 2] });
    assert.ok(evt);
    // snapshot is a deep copy — mutating live state must not retro-edit it
    s.set('nested', { list: [7] });
    s.restoreSnapshot(snap);
    assert.deepEqual(s.get('nested'), { list: [1, 2] });
  });

  test('restoreSnapshot rejects an invalid snapshot', () => {
    const s = new GlobalStore({});
    assert.throws(() => s.restoreSnapshot(null), /Invalid snapshot/);
    assert.throws(() => s.restoreSnapshot({}), /Invalid snapshot/);
  });
});

describe('GlobalStore transactions', () => {
  test('a committed transaction applies all mutations atomically in history', async () => {
    const s = new GlobalStore({ a: 0, b: 0 });
    s.saveHistory(); // explicit undo baseline (the store's contract)
    await s.transaction(async () => {
      s.set('a', 1);
      s.set('b', 2);
    });
    assert.deepEqual(s.get(), { a: 1, b: 2 });
    // one undo must revert the whole transaction, not half of it
    assert.equal(s.undo(), true);
    assert.deepEqual(s.get(), { a: 0, b: 0 });
  });

  test('a throwing transaction rolls back all intermediate state', async () => {
    const s = new GlobalStore({ a: 0, b: 0 });
    await assert.rejects(
      s.transaction(async () => {
        s.set('a', 1);
        throw new Error('mid-tx failure');
      }),
      /mid-tx failure/
    );
    assert.deepEqual(s.get(), { a: 0, b: 0 }, 'no partial commit');
  });
});
