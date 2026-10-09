const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

let db;
const baseline = fs.readFileSync(path.join(__dirname, '../migrations/20260810000000_event_outbox_and_read_model.sql'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../migrations/20261001115108_fence_event_outbox_claims.sql'), 'utf8');
before(async () => {
  db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await db.exec(baseline.slice(baseline.indexOf('create table if not exists event_outbox'), baseline.indexOf('-- 2.')));
  await db.exec('GRANT ALL ON event_outbox TO service_role;');
  await db.exec(migration);
});
after(async () => db.close());
beforeEach(async () => db.exec('RESET ROLE; DELETE FROM event_outbox;'));
async function seed(id = 'event-1', delay = '0 seconds') {
  await db.query("INSERT INTO event_outbox(event_id, aggregate_id, event_type, next_attempt_at) VALUES ($1,'order-1','order.created',now()+$2::interval)", [id, delay]);
}
async function claim(limit = 50, lease = 300000) {
  return (await db.query('SELECT * FROM claim_leased_outbox_events($1,$2)', [limit, lease])).rows;
}
async function settle(attempt, published = true, retry = 1000) {
  return (await db.query("SELECT settle_leased_outbox_event('event-1',$1,$2,'delivery failed',$3) AS accepted", [attempt, published, retry])).rows[0].accepted;
}
async function row() { return (await db.query("SELECT * FROM event_outbox WHERE event_id='event-1'")).rows[0]; }
async function expire() { await db.exec("UPDATE event_outbox SET next_attempt_at=now()-interval '1 second'"); }

test('live lease excludes a second claim and honors configured duration', async () => {
  await seed();
  const first = (await claim(1, 300000))[0];
  assert.equal(first.attempts, 1);
  assert.equal(first.status, 'publishing');
  assert.ok(Date.parse(first.next_attempt_at) - Date.now() > 290000);
  assert.deepEqual(await claim(), []);
});
test('due pending rows only; batch limits separate claimants', async () => {
  await seed('future', '1 hour'); await seed('event-1'); await seed('event-2');
  const a = await claim(1); const b = await claim(1);
  assert.equal(a.length, 1); assert.equal(b.length, 1);
  assert.notEqual(a[0].event_id, b[0].event_id);
  assert.deepEqual(await claim(), []);
});
test('expired lease is reclaimed with a new generation', async () => {
  await seed(); await claim(); await expire();
  assert.equal((await claim())[0].attempts, 2);
});
test('stale success cannot acknowledge a newer claim', async () => {
  await seed(); await claim(); await expire(); await claim();
  const before = await row();
  assert.equal(await settle(1), false);
  assert.deepEqual(await row(), before);
  assert.equal(await settle(2), true);
  assert.equal((await row()).status, 'published');
  assert.equal(await settle(2), false);
});
test('stale failure cannot requeue a newer claim', async () => {
  await seed(); await claim(); await expire(); await claim();
  const before = await row();
  assert.equal(await settle(1, false), false);
  assert.deepEqual(await row(), before);
});
test('expired owner cannot settle before another worker claims', async () => {
  await seed(); await claim(); await expire();
  assert.equal(await settle(1), false);
  assert.equal(await settle(1, false), false);
  assert.equal((await row()).status, 'publishing');
});
test('failed delivery schedules retry without incrementing attempts twice', async () => {
  await seed(); await claim();
  assert.equal(await settle(1, false, 60000), true);
  const failed = await row();
  assert.equal(failed.status, 'pending'); assert.equal(failed.attempts, 1);
  assert.equal(failed.last_error, 'delivery failed');
  assert.deepEqual(await claim(), []);
  await expire();
  assert.equal((await claim())[0].attempts, 2);
});
test('published row cannot be claimed and success clears failure diagnostics', async () => {
  await seed(); await claim(); assert.equal(await settle(1), true);
  const published = await row();
  assert.equal(published.last_error, null); assert.ok(published.published_at);
  assert.deepEqual(await claim(), []);
});
test('unknown event and wrong generation are harmless', async () => {
  assert.equal(await settle(1), false);
  await seed(); await claim(); assert.equal(await settle(999), false);
});
test('invalid claim/settlement parameters leave the queue untouched', async () => {
  await seed();
  for (const args of [[0, 1000], [1001, 1000], [1, 0], [1, 3600001]]) {
    await assert.rejects(claim(...args), /Invalid outbox claim/);
  }
  assert.equal((await row()).attempts, 0);
  await claim();
  await assert.rejects(settle(0), /Invalid outbox settlement/);
  await assert.rejects(settle(1, false, -1), /Invalid outbox settlement/);
  assert.equal((await row()).status, 'publishing');
});
test('anonymous/authenticated roles cannot call the internal RPCs', async () => {
  for (const role of ['anon','authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(claim(), /permission denied/);
    await assert.rejects(settle(1), /permission denied/);
    await assert.rejects(db.query("SELECT renew_leased_outbox_event('event-1',1,300000)"), /permission denied/);
    await db.exec('RESET ROLE');
  }
});
test('service role executes invoker RPC under the canonical RLS policy', async () => {
  await seed(); await db.exec('SET ROLE service_role');
  assert.equal((await claim())[0].attempts, 1);
  assert.equal(await settle(1), true);
  await db.exec('RESET ROLE');
});
test('migration is repeatable without losing existing claims', async () => {
  await seed(); await claim(); const before = await row();
  await db.exec(migration);
  assert.deepEqual(await row(), before);
  assert.equal(await settle(1), true);
});

test('renewal extends only the current live claim without incrementing attempts', async () => {
  await seed(); await claim(1, 60000);
  const result = await db.query("SELECT renew_leased_outbox_event('event-1',1,300000) AS accepted");
  assert.equal(result.rows[0].accepted, true);
  assert.equal((await row()).attempts, 1);
  assert.ok(Date.parse((await row()).next_attempt_at) - Date.now() > 290000);
  await expire();
  assert.equal((await db.query("SELECT renew_leased_outbox_event('event-1',1,300000) AS accepted")).rows[0].accepted, false);
  await claim();
  assert.equal((await db.query("SELECT renew_leased_outbox_event('event-1',1,300000) AS accepted")).rows[0].accepted, false);
});
