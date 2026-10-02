import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const state = vi.hoisted(() => ({ database: null, redis: null, log: null }));
vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() { return state.database; },
  get redisClient() { return state.redis; },
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: (...args) => state.log.push(args), warn() {}, error() {}, debug() {} },
}));
vi.mock('../../src/core/telemetry/WorkerTracer.js', () => ({
  WorkerTracer: { wrapCronJob: (_name, fn) => fn },
}));
vi.mock('node-cron', () => ({ default: { schedule: vi.fn(() => ({ stop: vi.fn() })) } }));

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function devices(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i).padStart(4, '0'), is_active: true, last_seen: '2020-01-01T00:00:00Z',
  }));
}
function redisFixture() {
  const redis = { owner: null, renewals: 0, failAt: 0, releaseError: false };
  redis.set = vi.fn(async (_key, token) => {
    if (redis.owner) return null;
    redis.owner = token;
    return 'OK';
  });
  redis.del = vi.fn(async () => { redis.owner = null; return 1; });
  redis.eval = vi.fn(async (script, _keys, _key, token) => {
    if (script.includes("'expire'")) {
      redis.renewals++;
      if (redis.renewals === redis.failAt) throw new Error('redis unavailable');
      return redis.owner === token ? 1 : 0;
    }
    if (redis.releaseError) throw new Error('cleanup unavailable');
    if (redis.owner !== token) return 0;
    redis.owner = null;
    return 1;
  });
  return redis;
}
function databaseFixture(rows) {
  const db = { rows, reads: [], updates: [], readHook: null, updateHook: null, readError: null, updateError: null };
  db.from = vi.fn(() => {
    const filters = [], orders = [];
    let mode = 'select', payload, limit = Infinity;
    const builder = {
      select() { return this; },
      eq(key, value) { filters.push(row => row[key] === value); return this; },
      lt(key, value) { filters.push(row => row[key] < value); return this; },
      in(key, values) { filters.push(row => values.includes(row[key])); return this; },
      order(key) { orders.push(key); return this; },
      limit(value) { limit = value; return this; },
      update(value) { mode = 'update'; payload = value; return this; },
      then(resolve, reject) {
        const run = async () => {
          if (mode === 'select') {
            const selected = db.rows.filter(row => filters.every(filter => filter(row)))
              .sort((a, b) => {
                for (const key of orders) {
                  if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
                }
                return 0;
              }).slice(0, limit).map(row => ({ id: row.id }));
            db.reads.push({ ids: selected.map(row => row.id), limit, orders });
            if (db.readHook) await db.readHook();
            return { data: selected, error: db.readError };
          }
          db.updates.push(payload);
          if (db.updateHook) await db.updateHook();
          if (db.updateError) return { data: null, error: db.updateError };
          const selected = db.rows.filter(row => filters.every(filter => filter(row)));
          selected.forEach(row => Object.assign(row, payload));
          return { data: selected.map(row => ({ id: row.id })), error: null };
        };
        return run().then(resolve, reject);
      },
    };
    return builder;
  });
  return db;
}
let worker;
beforeEach(async () => {
  vi.resetModules();
  state.log = [];
  state.redis = redisFixture();
  state.database = databaseFixture(devices(1));
  vi.stubEnv('DEVICE_PRUNE_BATCH_SIZE', '2');
  vi.stubEnv('DEVICE_PRUNE_MAX_BATCHES', '3');
  vi.stubEnv('DEVICE_STALE_THRESHOLD_DAYS', '90');
  worker = await import('../../src/workers/devicePruningWorker.js');
});
afterEach(() => vi.unstubAllEnvs());

describe('bounded device-pruning lifecycle', () => {
  it('drains successive first pages without offset-skipping remaining rows', async () => {
    state.database = databaseFixture(devices(5));
    await worker.pruneStaleDevices();
    expect(state.database.rows.every(row => !row.is_active)).toBe(true);
    expect(state.database.reads.map(read => read.ids)).toEqual([['0000', '0001'], ['0002', '0003'], ['0004']]);
    expect(state.database.reads.every(read => read.limit === 2)).toBe(true);
    expect(state.log.at(-1)[0]).toMatchObject({ deactivated: 5, batches: 3 });
  });
  it('stops at the explicit batch cap and resumes remaining work on a later sweep', async () => {
    state.database = databaseFixture(devices(8));
    await worker.pruneStaleDevices();
    expect(state.database.rows.filter(row => row.is_active)).toHaveLength(2);
    expect(state.database.reads).toHaveLength(3);
    await worker.pruneStaleDevices();
    expect(state.database.rows.every(row => !row.is_active)).toBe(true);
  });
  it('preserves a device refreshed between candidate read and guarded update', async () => {
    state.database.readHook = () => { state.database.rows[0].last_seen = new Date().toISOString(); };
    await worker.pruneStaleDevices();
    expect(state.database.rows[0].is_active).toBe(true);
    expect(state.database.rows[0].deactivated_at).toBeUndefined();
    expect(state.log.at(-1)[0].deactivated).toBe(0);
  });
  it('stops after a delayed read loses its lease and preserves its successor', async () => {
    const gate = deferred();
    state.database.readHook = () => gate.promise;
    const pending = worker.pruneStaleDevices();
    await tick();
    state.redis.owner = 'successor';
    gate.resolve();
    await pending;
    expect(state.database.updates).toHaveLength(0);
    expect(state.database.reads).toHaveLength(1);
    expect(state.redis.owner).toBe('successor');
    expect(state.redis.del).not.toHaveBeenCalled();
  });
  it('a disappearing module client does not convert an owned run into no-Redis mode', async () => {
    const gate = deferred(), originalClient = state.redis;
    state.database.readHook = () => gate.promise;
    const pending = worker.pruneStaleDevices();
    await tick();
    originalClient.owner = 'successor';
    state.redis = null;
    gate.resolve();
    await pending;
    expect(state.database.updates).toHaveLength(0);
    expect(originalClient.owner).toBe('successor');
  });
  it.each([1, 2])('fails closed when renewal %i rejects', async (renewal) => {
    state.redis.failAt = renewal;
    await worker.pruneStaleDevices();
    expect(state.database.updates).toHaveLength(0);
    expect(state.database.reads).toHaveLength(renewal - 1);
    expect(state.redis.owner).toBeNull();
  });
  it('retains the local running guard until an already-dispatched update settles', async () => {
    const gate = deferred();
    state.database.updateHook = () => gate.promise;
    const pending = worker.pruneStaleDevices();
    await tick();
    await worker.pruneStaleDevices();
    expect(state.redis.set).toHaveBeenCalledTimes(1);
    state.redis.owner = 'successor';
    gate.resolve();
    await pending;
    expect(state.database.reads).toHaveLength(1);
    expect(state.redis.owner).toBe('successor');
  });
  it('uses a fresh per-run token rather than a shared PID', async () => {
    await worker.pruneStaleDevices();
    await worker.pruneStaleDevices();
    const tokens = state.redis.set.mock.calls.map(call => call[1]);
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).not.toBe(tokens[1]);
    expect(tokens.every(token => token !== String(process.pid))).toBe(true);
  });
  it('held lease prevents candidate queries or cleanup', async () => {
    state.redis.owner = 'other';
    await worker.pruneStaleDevices();
    expect(state.database.reads).toHaveLength(0);
    expect(state.redis.eval).not.toHaveBeenCalled();
    expect(state.redis.owner).toBe('other');
  });
  it.each(['readError', 'updateError'])('stops batch processing after %s and permits later retry', async (key) => {
    state.database[key] = { message: 'database unavailable' };
    await worker.pruneStaleDevices();
    expect(state.database.reads).toHaveLength(1);
    expect(state.database.rows[0].is_active).toBe(true);
    state.database[key] = null;
    await worker.pruneStaleDevices();
    expect(state.database.rows[0].is_active).toBe(false);
  });
  it('release failure does not strand process-local ownership', async () => {
    state.redis.releaseError = true;
    await worker.pruneStaleDevices();
    state.redis = redisFixture();
    await worker.pruneStaleDevices();
    expect(state.redis.set).toHaveBeenCalledTimes(1);
  });
  it('no Redis keeps process-local exclusion through pending reads', async () => {
    state.redis = null;
    const gate = deferred();
    state.database.readHook = () => gate.promise;
    const pending = worker.pruneStaleDevices();
    await tick();
    await worker.pruneStaleDevices();
    expect(state.database.reads).toHaveLength(1);
    gate.resolve();
    await pending;
    expect(state.database.rows[0].is_active).toBe(false);
  });
  it('empty candidates stop immediately without update', async () => {
    state.database = databaseFixture([]);
    await worker.pruneStaleDevices();
    expect(state.database.reads).toHaveLength(1);
    expect(state.database.updates).toHaveLength(0);
  });
  it('missing admin client does not acquire a lease', async () => {
    state.database = null;
    await worker.pruneStaleDevices();
    expect(state.redis.set).not.toHaveBeenCalled();
  });
  it('configuration stays finite and candidate selection is deterministic', async () => {
    vi.stubEnv('DEVICE_PRUNE_BATCH_SIZE', '100000');
    vi.stubEnv('DEVICE_PRUNE_MAX_BATCHES', '-1');
    vi.stubEnv('DEVICE_STALE_THRESHOLD_DAYS', 'Infinity');
    await worker.pruneStaleDevices();
    expect(state.database.reads[0]).toMatchObject({ limit: 1000, orders: ['last_seen', 'id'] });
    expect(state.log.at(-1)[0]).toMatchObject({ maxBatches: 10, staleDays: 90 });
  });
  it('actual worker query preserves a refreshed row in PostgreSQL-compatible execution', async () => {
    const db = new PGlite();
    try {
      await db.exec(`CREATE TABLE user_devices(id text PRIMARY KEY, is_active boolean, last_seen timestamptz, deactivated_at timestamptz);
        INSERT INTO user_devices VALUES('stale', true, '2020-01-01', NULL), ('refreshed', true, '2020-01-01', NULL), ('inactive', false, '2020-01-01', NULL);`);
      let readCount = 0;
      state.database = {
        from: () => {
          const predicates = [], values = [], order = [];
          let payload = null, limit = 1000;
          const parameter = value => { values.push(value); return '$' + values.length; };
          const builder = {
            select() { return this; },
            eq(column, value) { predicates.push(`${column} = ${parameter(value)}`); return this; },
            lt(column, value) { predicates.push(`${column} < ${parameter(value)}`); return this; },
            in(column, value) { predicates.push(`${column} = ANY(${parameter(value)}::text[])`); return this; },
            order(column) { order.push(column); return this; },
            limit(value) { limit = value; return this; },
            update(value) { payload = value; return this; },
            then(resolve, reject) {
              const run = async () => {
                let result;
                if (payload) {
                  const assignments = Object.entries(payload).map(([key, value]) => `${key} = ${parameter(value)}`);
                  result = await db.query(`UPDATE user_devices SET ${assignments.join(',')}
                    WHERE ${predicates.join(' AND ')} RETURNING id`, values);
                } else {
                  result = await db.query(`SELECT id FROM user_devices WHERE ${predicates.join(' AND ')}
                    ${order.length ? 'ORDER BY ' + order.join(',') : ''} LIMIT ${parameter(limit)}`, values);
                  if (readCount++ === 0) await db.query("UPDATE user_devices SET last_seen=now() WHERE id='refreshed'");
                }
                return { data: result.rows, error: null };
              };
              return run().then(resolve, reject);
            },
          };
          return builder;
        },
      };
      await worker.pruneStaleDevices();
      const result = await db.query('SELECT id, is_active, deactivated_at IS NOT NULL AS changed FROM user_devices ORDER BY id');
      expect(result.rows).toEqual([
        { id: 'inactive', is_active: false, changed: false },
        { id: 'refreshed', is_active: true, changed: false },
        { id: 'stale', is_active: false, changed: true },
      ]);
    } finally { await db.close(); }
  });
});
