import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const { state, anon, createUserClient, noop } = vi.hoisted(() => {
  const state = { db: null };
  const quote = value => `"${value}"`;
  function client(token) {
    return { from: vi.fn(table => {
      let columns = '*';
      let update;
      let insert;
      let ordering = '';
      let pagination = '';
      const filters = [];
      const query = {
        select: value => { columns = value; return query; },
        eq: (field, value) => { filters.push([field, value]); return query; },
        update: values => { update = values; return query; },
        insert: values => { insert = values; return query; },
        order: (field, options) => { ordering = ` ORDER BY ${quote(field)} ${options?.ascending === false ? 'DESC' : 'ASC'}`; return query; },
        range: (from, to) => { pagination = ` LIMIT ${to - from + 1} OFFSET ${from}`; return query; },
        maybeSingle: async () => { const result = await run(); return { ...result, data: result.data?.[0] || null }; },
        single: async () => {
          const result = await query.maybeSingle();
          return result.data ? result : { ...result, error: result.error || { message: 'Row not found' } };
        },
        then: (resolve, reject) => run().then(resolve, reject),
      };
      async function run() {
        const values = [];
        const bind = value => { values.push(value); return `$${values.length}`; };
        const selected = columns === '*' ? '*' : columns.split(',').map(s => quote(s.trim())).join(',');
        const prefix = update
          ? `UPDATE ${quote(table)} SET ${Object.entries(update).map(([key, value]) => `${quote(key)} = ${bind(value)}`).join(',')}`
          : insert
            ? `INSERT INTO ${quote(table)} (${Object.keys(insert).map(quote).join(',')}) VALUES (${Object.values(insert).map(bind).join(',')})`
            : `SELECT ${selected} FROM ${quote(table)}`;
        const where = filters.length ? ` WHERE ${filters.map(([key, value]) => `${quote(key)} = ${bind(value)}`).join(' AND ')}` : '';
        try {
          await state.db.exec('RESET ROLE');
          await state.db.query("SELECT set_config('request.jwt.claims', $1, false)",
            [JSON.stringify({ sub: token === 'owner-token' ? 'auth-owner' : 'auth-other' })]);
          await state.db.exec(`SET ROLE ${token ? 'authenticated' : 'anon'}`);
          const result = await state.db.query(prefix + where + (update || insert ? ` RETURNING ${selected}` : ordering + pagination), values);
          return { data: result.rows, error: null, count: result.rows.length };
        } catch (error) {
          return { data: null, error: { message: error.message }, count: 0 };
        }
      }
      return query;
    }) };
  }
  return { state, anon: client(null), createUserClient: vi.fn(token => client(token)),
    noop: (_req, _res, next) => next() };
});
vi.mock('../../src/config/db.js', () => ({ supabase: anon, getAdminClient: () => anon,
  createUserClient, redisClient: null }));
vi.mock('../../src/middleware/auth.js', () => ({ authenticate: noop }));
vi.mock('../../src/middleware/apiKey.js', () => ({ requireApiKey: noop }));
vi.mock('../../src/middleware/requirePolicy.js', () => ({ requirePolicy: () => noop }));
vi.mock('../../src/middleware/rateLimiter.js', () => ({ userLimiter: noop }));
vi.mock('../../src/middleware/validate.js', () => ({ validateBody: () => noop, validateQuery: () => noop, validateParams: () => noop }));
vi.mock('../../src/middleware/auditLog.js', () => ({ auditLog: () => noop }));
vi.mock('../../src/middleware/idempotency.js', () => ({ requireIdempotency: () => noop }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('express-rate-limit', () => ({ default: () => noop }));
vi.mock('../../src/services/reputation.js', () => ({ getDriverReputation: vi.fn() }));
vi.mock('../../src/services/ml.js', () => ({ predictDriverProfit: vi.fn() }));
vi.mock('../../src/services/weighStationService.js', () => ({ checkBypassEligibility: vi.fn(), syncAndTransmitInternalWeights: vi.fn() }));
vi.mock('../../src/services/wallet/payoutProvider.js', () => ({ isPayoutProviderConfigured: () => true }));
vi.mock('../../src/controllers/driverController.js', () => ({ default: new Proxy({}, { get: () => noop }) }));
import driverRoutes from '../../src/routes/driverRoutes.js';
const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
const owner = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const truckId = '20000000-0000-0000-0000-000000000001';
const otherTruck = '20000000-0000-0000-0000-000000000002';

describe('driver router authenticated clients and RLS', () => {
  beforeAll(async () => {
    state.db = new PGlite();
    await state.db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
        SELECT current_setting('request.jwt.claims', true)::jsonb;
      $$;
      CREATE TABLE profiles (id uuid PRIMARY KEY, firebase_uid text);
      INSERT INTO profiles VALUES ('${owner}', 'auth-owner'), ('${other}', 'auth-other');
      CREATE FUNCTION get_profile_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp AS $$ SELECT id FROM profiles WHERE firebase_uid = auth.jwt()->>'sub'; $$;
      CREATE TABLE driver_details (user_id uuid PRIMARY KEY, rating numeric, total_trips integer,
        completion_rate numeric, is_online boolean, wallet_confirmed bigint, wallet_pending bigint,
        wallet_total bigint, truck_id uuid, updated_at timestamptz, hos_status text,
        accumulated_driving_minutes integer, accumulated_on_duty_minutes integer, shift_start_time timestamptz);
      CREATE TABLE trucks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), driver_id uuid, name text,
        truck_type text, max_capacity_tons numeric, number_plate text, updated_at timestamptz);
      CREATE TABLE wallet_transactions (id serial PRIMARY KEY, driver_id uuid, amount bigint, created_at timestamptz DEFAULT now());
      INSERT INTO trucks (id, driver_id, truck_type, number_plate) VALUES
        ('${truckId}', '${owner}', 'Open Body', 'OWN'), ('${otherTruck}', '${other}', 'Open Body', 'OTHER');
      INSERT INTO driver_details (user_id, rating, total_trips, completion_rate, is_online, truck_id, wallet_confirmed)
        VALUES ('${owner}', 4.5, 10, 98, false, '${truckId}', 10000), ('${other}', 3, 5, 90, false, '${otherTruck}', 99999);
      INSERT INTO wallet_transactions (driver_id, amount) VALUES ('${owner}', 10000), ('${other}', 99999);
      GRANT USAGE ON SCHEMA public, auth TO authenticated;
      GRANT SELECT ON driver_details, trucks, wallet_transactions TO authenticated;
      GRANT UPDATE (is_online, hos_status, truck_id, updated_at) ON driver_details TO authenticated;
      GRANT INSERT, UPDATE ON trucks TO authenticated;
      ALTER TABLE driver_details ENABLE ROW LEVEL SECURITY;
      ALTER TABLE trucks ENABLE ROW LEVEL SECURITY;
      ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
      CREATE POLICY own_details ON driver_details TO authenticated
        USING (user_id = get_profile_id()) WITH CHECK (user_id = get_profile_id());
      CREATE POLICY own_trucks ON trucks TO authenticated
        USING (driver_id = get_profile_id()) WITH CHECK (driver_id = get_profile_id());
      CREATE POLICY own_wallet ON wallet_transactions FOR SELECT TO authenticated USING (driver_id = get_profile_id());
    `);
  });
  afterAll(async () => { await state.db?.close(); });
  beforeEach(async () => {
    vi.clearAllMocks();
    await state.db.exec(`RESET ROLE; UPDATE driver_details SET is_online = false, truck_id = '${truckId}' WHERE user_id = '${owner}';`);
  });

  async function run(path, body = {}, token = 'owner-token', userId = owner, method = 'get') {
    const route = driverRoutes.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    await route.stack.at(-1).handle({ user: { id: userId, role: 'driver' }, token, body, query: {} }, res);
    return res;
  }

  it('reads own stats and truck with one client and never uses anon', async () => {
    const res = await run('/stats');
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].truck.number_plate).toBe('OWN');
    expect(createUserClient).toHaveBeenCalledExactlyOnceWith('owner-token');
    expect(anon.from).not.toHaveBeenCalled();
  });
  for (const [path, body, method] of [
    ['/online', { is_online: true }, 'put'],
    ['/hos/status', { status: 'on_duty' }, 'put'],
    ['/availability', { available: true }, 'patch'],
  ]) {
    it(`updates only own ${path} through authenticated nonfinancial privileges`, async () => {
      const res = await run(path, body, 'owner-token', owner, method);
      expect(res.status).not.toHaveBeenCalled();
      const responseField = path === '/hos/status' ? 'status' : path === '/availability' ? 'isOnline' : 'is_online';
      expect(res.json.mock.calls[0][0][responseField]).toBe(path === '/hos/status' ? 'on_duty' : true);
      await state.db.exec('RESET ROLE');
      const result = await state.db.query('SELECT is_online, hos_status FROM driver_details WHERE user_id = $1', [other]);
      expect(result.rows[0].is_online).toBe(false);
      expect(result.rows[0].hos_status).toBe(null);
      expect(createUserClient).toHaveBeenCalledExactlyOnceWith('owner-token');
      expect(anon.from).not.toHaveBeenCalled();
    });
  }
  it('returns only own wallet transactions', async () => {
    const res = await run('/wallet/history');
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].transactions.map(row => row.driver_id)).toEqual([owner]);
  });
  it('updates an owned truck and reuses the client for its details lookup', async () => {
    const res = await run('/truck', { type: 'Container', registrationNumber: 'NEW', capacityWeight: 20 }, 'owner-token', owner, 'put');
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].truck.number_plate).toBe('NEW');
    expect(createUserClient).toHaveBeenCalledTimes(1);
  });
  it('RLS hides a foreign truck even if driver_details points to it', async () => {
    await state.db.query('UPDATE driver_details SET truck_id = $1 WHERE user_id = $2', [otherTruck, owner]);
    const res = await run('/stats');
    expect(res.json.mock.calls[0][0].truck).toBe(null);
  });
  it('a mismatching request user cannot read another profile through the JWT client', async () => {
    expect((await run('/stats', {}, 'owner-token', other)).status).toHaveBeenCalledWith(404);
  });
  it('separate requests never share clients or credentials', async () => {
    await run('/stats');
    const res = await run('/stats', {}, 'other-token', other);
    expect(res.json.mock.calls[0][0].truck.number_plate).toBe('OTHER');
    expect(createUserClient.mock.calls).toEqual([['owner-token'], ['other-token']]);
  });
  it('missing token fails without querying anon or constructing a user client', async () => {
    expect((await run('/stats', {}, null)).status).toHaveBeenCalledWith(500);
    expect(anon.from).not.toHaveBeenCalled();
    expect(createUserClient).not.toHaveBeenCalled();
  });
});
