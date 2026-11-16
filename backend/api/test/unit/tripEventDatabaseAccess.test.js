import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const { state, anon, admin, noop } = vi.hoisted(() => {
  const state = { db: null, fail: null };
  const quote = name => `"${name}"`;
  function client(role) {
    return { from: vi.fn(table => {
      let columns = '*';
      let records;
      let conflict;
      let ordering = '';
      let pagination = '';
      const filters = [];
      const query = {
        select: value => { columns = value; return query; },
        eq: (key, value) => { filters.push([key, [value]]); return query; },
        in: (key, values) => { filters.push([key, values]); return query; },
        insert: value => { records = [value]; return query; },
        upsert: (values, options) => { records = values; conflict = options; return query; },
        order: (key, options) => { ordering = ` ORDER BY ${quote(key)} ${options.ascending ? 'ASC' : 'DESC'}`; return query; },
        range: (from, to) => { pagination = ` LIMIT ${to - from + 1} OFFSET ${from}`; return query; },
        maybeSingle: async () => { const result = await run(); return { ...result, data: result.data?.[0] || null }; },
        then: (resolve, reject) => run().then(resolve, reject),
      };
      async function run() {
        if (state.fail === table) return { data: null, error: { message: 'Database unavailable' } };
        const values = [];
        const bind = value => { values.push(value); return `$${values.length}`; };
        const selected = columns === '*' ? '*' : columns.split(',').map(s => quote(s.trim())).join(',');
        const keys = records && Object.keys(records[0]);
        const sql = records
          ? `INSERT INTO ${quote(table)} (${keys.map(quote).join(',')}) VALUES ${records.map(row => `(${keys.map(key => bind(row[key])).join(',')})`).join(',')}` +
            (conflict ? ` ON CONFLICT (${quote(conflict.onConflict)}) ${conflict.ignoreDuplicates ? 'DO NOTHING' : `DO UPDATE SET ${keys.map(key => `${quote(key)} = EXCLUDED.${quote(key)}`).join(',')}`}` : '')
          : `SELECT ${selected} FROM ${quote(table)}` +
            (filters.length ? ` WHERE ${filters.map(([key, entries]) => `${quote(key)} IN (${entries.map(bind).join(',')})`).join(' AND ')}` : '') + ordering + pagination;
        try {
          await state.db.exec(`RESET ROLE; SET ROLE ${role}`);
          const result = await state.db.query(sql, values);
          return { data: result.rows, error: null, count: result.rows.length };
        } catch (error) {
          return { data: null, error: { message: error.message } };
        }
      }
      return query;
    }) };
  }
  return { state, anon: client('anon'), admin: client('service_role'), noop: (_req, _res, next) => next() };
});
vi.mock('../../src/config/db.js', () => ({ supabase: anon, supabaseAdmin: admin }));
vi.mock('../../src/middleware/auth.js', () => ({ authenticate: noop }));
vi.mock('../../src/middleware/rateLimiter.js', () => ({ userLimiter: noop }));
vi.mock('../../src/middleware/validate.js', () => ({ validateParams: () => noop }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
import tripRoutes from '../../src/routes/tripRoutes.js';
const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
const driver = '10000000-0000-0000-0000-000000000001';
const customer = '10000000-0000-0000-0000-000000000002';
const stranger = '10000000-0000-0000-0000-000000000003';
const orderId = '20000000-0000-0000-0000-000000000001';
const displayId = '#FF20260930ABCDEFGHIJKL';
const event = { id: 'event-one', trip_id: `TX-${displayId}`, type: 'gpsUpdate',
  occurred_at: '2026-09-30T10:00:00Z', payload: { lat: 20, lng: 70 } };
async function run(path, { userId = driver, role = 'driver', body = {}, method = 'post', params = {} } = {}) {
  const route = tripRoutes.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
  const res = { status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res);
  await route.stack.at(-1).handle({ user: { id: userId, role }, body, params, query: {} }, res);
  return res;
}
const batch = (options = {}) => run('/events/batch', { body: { events: [{ ...event }], idempotencyKey: 'batch-one' }, ...options });

describe('trip event server-side access behind ownership gates', () => {
  beforeAll(async () => {
    state.db = new PGlite();
    await state.db.exec(`
      CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE orders (id uuid PRIMARY KEY, order_display_id text, driver_id uuid, customer_id uuid);
      CREATE TABLE trip_events (event_id text PRIMARY KEY, user_id uuid, trip_id uuid, event_type text,
        event_timestamp timestamptz, latitude numeric, longitude numeric, metadata jsonb, created_at timestamptz);
      CREATE TABLE processed_batches (id serial PRIMARY KEY, idempotency_key text, user_id uuid, event_count integer,
        processed_at timestamptz, UNIQUE(user_id, idempotency_key));
      ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
      ALTER TABLE trip_events ENABLE ROW LEVEL SECURITY;
      ALTER TABLE processed_batches ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON orders, trip_events, processed_batches FROM anon;
      GRANT USAGE ON SCHEMA public TO service_role;
      GRANT ALL ON orders, trip_events, processed_batches TO service_role;
      GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
      INSERT INTO orders VALUES ('${orderId}', '${displayId}', '${driver}', '${customer}');
    `);
  });
  afterAll(async () => { await state.db?.close(); });
  beforeEach(async () => {
    state.fail = null; vi.clearAllMocks();
    await state.db.exec('RESET ROLE; TRUNCATE trip_events, processed_batches');
  });
  it('persists an owned batch despite revoked anon access', async () => {
    const res = await batch();
    expect(res.status).toHaveBeenCalledWith(202);
    await state.db.exec('RESET ROLE');
    expect((await state.db.query('SELECT user_id, trip_id FROM trip_events')).rows).toEqual([{ user_id: driver, trip_id: orderId }]);
    expect((await state.db.query('SELECT user_id FROM processed_batches')).rows).toEqual([{ user_id: driver }]);
    expect(anon.from).not.toHaveBeenCalled();
  });
  it('acknowledges a repeated batch without inserting it again', async () => {
    await batch();
    const res = await batch();
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ message: 'Batch already processed.' });
    await state.db.exec('RESET ROLE');
    expect((await state.db.query('SELECT count(*)::integer AS n FROM trip_events')).rows[0].n).toBe(1);
  });
  it('a retry with a new batch key preserves the immutable event', async () => {
    await batch();
    const res = await batch({ body: { events: [{ ...event, payload: { lat: 30, lng: 80 } }], idempotencyKey: 'batch-two' } });
    expect(res.status).toHaveBeenCalledWith(202);
    await state.db.exec('RESET ROLE');
    expect(Number((await state.db.query('SELECT latitude FROM trip_events')).rows[0].latitude)).toBe(20);
  });
  it('an event-ID collision cannot overwrite another uploader', async () => {
    await batch();
    const res = await batch({ userId: customer, role: 'customer' });
    expect(res.status).toHaveBeenCalledWith(202);
    await state.db.exec('RESET ROLE');
    expect((await state.db.query('SELECT user_id, trip_id FROM trip_events')).rows).toEqual([{ user_id: driver, trip_id: orderId }]);
  });
  it('rejects a foreign trip before idempotency lookup or writes', async () => {
    const res = await batch({ userId: stranger });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(admin.from.mock.calls.map(([table]) => table)).toEqual(['orders']);
  });
  it.each(['orders', 'trip_events'])('returns 500 on a %s database failure', async table => {
    state.fail = table;
    expect((await batch()).status).toHaveBeenCalledWith(500);
  });
  it('lets the owning customer read driver-uploaded events after the ownership check', async () => {
    await batch();
    const res = await run('/:id/events', { userId: customer, role: 'customer', method: 'get', params: { id: orderId } });
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].events.map(row => row.user_id)).toEqual([driver]);
    expect(anon.from).not.toHaveBeenCalled();
  });
  it('resolves display IDs for admin uploads as well', async () => {
    const res = await batch({ userId: stranger, role: 'admin' });
    expect(res.status).toHaveBeenCalledWith(202);
    await state.db.exec('RESET ROLE');
    expect((await state.db.query('SELECT trip_id FROM trip_events')).rows).toEqual([{ trip_id: orderId }]);
  });
  it('supports events without a trip reference', async () => {
    const res = await batch({ body: { events: [{ ...event, trip_id: null }], idempotencyKey: 'unlinked' } });
    expect(res.status).toHaveBeenCalledWith(202);
    await state.db.exec('RESET ROLE');
    expect((await state.db.query('SELECT trip_id FROM trip_events')).rows).toEqual([{ trip_id: null }]);
  });
  it('rejects a foreign reader before querying events', async () => {
    const res = await run('/:id/events', { userId: stranger, method: 'get', params: { id: orderId } });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(admin.from.mock.calls.map(([table]) => table)).toEqual(['orders']);
  });
});
