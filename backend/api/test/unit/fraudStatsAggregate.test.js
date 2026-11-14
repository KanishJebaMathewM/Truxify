import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

const state = vi.hoisted(() => ({ db: null, error: vi.fn() }));
vi.mock('../../src/config/db.js', () => ({ get supabaseAdmin() { return state.db; }, redisClient: null }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: state.error } }));
vi.mock('../../src/lib/redisLock.js', () => ({ withLock: (_key, fn) => fn() }));
import service from '../../src/services/fraud/FraudDetectionService.js';

const empty = { total: 0, highRisk: 0, mediumRisk: 0, lowRisk: 0, avgScore: 0 };
const migration = readFileSync(new URL('../../../../supabase/migrations/20261002153802_fraud_stats_aggregate.sql', import.meta.url), 'utf8');
let pg;
let client;
async function rpcStats() {
  const { rows } = await pg.query('select public.get_fraud_stats_aggregate() as stats');
  return rows[0].stats;
}
async function seed(values) {
  await pg.query('insert into public.fraud_risk_scores(user_id, risk_score) select $1::uuid, v from unnest($2::double precision[]) v',
    ['00000000-0000-0000-0000-000000000001', values]);
}
const oracle = values => ({
  total: values.length,
  highRisk: values.filter(v => v > 0.7).length,
  mediumRisk: values.filter(v => v > 0.4 && v <= 0.7).length,
  lowRisk: values.filter(v => v <= 0.4).length,
  avgScore: values.reduce((sum, v) => sum + v, 0) / values.length || 0
});

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec('create role anon; create role authenticated; create role service_role; create table public.profiles(id uuid primary key);');
  // Execute existing repository schema, including its numeric column and policies.
  await pg.exec(readFileSync(new URL('../../../../supabase/migrations/20260804101500_create_fraud_tables.sql', import.meta.url), 'utf8'));
  await pg.exec(readFileSync(new URL('../../../../supabase/migrations/20260805000040_create_fraud_tables.sql', import.meta.url), 'utf8'));
  await pg.exec("insert into profiles values ('00000000-0000-0000-0000-000000000001'); grant usage on schema public to service_role; grant select on public.fraud_risk_scores to service_role;");
  await pg.exec(migration);
}, 30000);

beforeEach(async () => {
  await pg.exec('truncate public.fraud_risk_scores');
  state.error.mockClear();
  client = {
    rpc: vi.fn(async name => {
      expect(name).toBe('get_fraud_stats_aggregate');
      return { data: await rpcStats(), error: null };
    }),
    from: vi.fn(() => { throw new Error('Row-history transfer is forbidden'); })
  };
  state.db = client;
});

afterAll(async () => {
  service.destroy();
  clearInterval(service._flushInterval);
  await pg.close();
});

describe('actual fraud service with PostgreSQL aggregation', () => {
  it('returns the existing empty-table values in one RPC', async () => {
    expect(await service.getFraudStats()).toEqual(empty);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.from).not.toHaveBeenCalled();
  });
  it('preserves exact bucket boundaries against an independent former-reducer oracle', async () => {
    const values = [0, 0.4, 0.4000000001, 0.7, 0.7000000001, 1];
    await seed(values);
    const actual = await service.getFraudStats();
    expect(actual).toEqual(oracle(values));
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });
  it('includes 100000 same-timestamp rows with one fixed-size response', async () => {
    await pg.exec("insert into public.fraud_risk_scores(user_id,risk_score,created_at) select '00000000-0000-0000-0000-000000000001'::uuid, (i%10)::numeric/10, '2026-10-02T00:00:00Z'::timestamptz from generate_series(1,100000) i");
    const result = await service.getFraudStats();
    expect({ ...result, avgScore: expect.any(Number) }).toEqual({ total: 100000, highRisk: 20000, mediumRisk: 30000, lowRisk: 50000, avgScore: expect.any(Number) });
    expect(result.avgScore).toBeCloseTo(0.45, 10);
    expect(Object.keys(result)).toHaveLength(5);
    expect(JSON.stringify(result).length).toBeLessThan(150);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.from).not.toHaveBeenCalled();
  }, 30000);
  it('works with the alternative existing double-precision schema', async () => {
    await pg.exec('alter table public.fraud_risk_scores alter column risk_score type double precision');
    await seed([0.4, 0.7, 0.8]);
    const result = await service.getFraudStats();
    expect(result.total).toBe(3);
    expect([result.lowRisk, result.mediumRisk, result.highRisk]).toEqual([1, 1, 1]);
    expect(result.avgScore).toBeCloseTo((0.4 + 0.7 + 0.8) / 3, 12);
    await pg.exec('alter table public.fraud_risk_scores alter column risk_score type numeric');
  });
  it('retains zeros when Supabase is not configured', async () => {
    state.db = null;
    expect(await service.getFraudStats()).toEqual(empty);
  });
  it.each(['PGRST202', '57014', '42501'])('retains returned database-error zeros for %s without a row-scan fallback', async code => {
    client.rpc.mockResolvedValue({ data: null, error: { code, message: 'controlled fixture' } });
    expect(await service.getFraudStats()).toEqual(empty);
    expect(state.error).toHaveBeenCalledTimes(1);
    expect(client.from).not.toHaveBeenCalled();
  });
  it('preserves transport rejection identity', async () => {
    const error = new Error('transport fixture');
    client.rpc.mockRejectedValue(error);
    await expect(service.getFraudStats()).rejects.toBe(error);
  });
  it.each([null, {}, { ...empty, total: -1 }, { ...empty, total: 2 }, { ...empty, avgScore: Infinity }, { ...empty, total: '0' }, { ...empty, total: Number.MAX_SAFE_INTEGER + 1 }])('rejects malformed aggregate payload %# without returning partial totals', async data => {
    client.rpc.mockResolvedValue({ data, error: null });
    expect(await service.getFraudStats()).toEqual(empty);
    expect(state.error).toHaveBeenCalledTimes(1);
  });
  it('returns only the existing fields even when an RPC payload has extras', async () => {
    client.rpc.mockResolvedValue({ data: { ...empty, internal: 'fixture' }, error: null });
    expect(await service.getFraudStats()).toEqual(empty);
  });
});

describe('aggregate function execution contract', () => {
  it('restricts execution to the existing service role', async () => {
    const { rows } = await pg.query("select has_function_privilege('anon','public.get_fraud_stats_aggregate()','execute') as anon, has_function_privilege('authenticated','public.get_fraud_stats_aggregate()','execute') as authenticated, has_function_privilege('service_role','public.get_fraud_stats_aggregate()','execute') as service");
    expect(rows[0]).toEqual({ anon: false, authenticated: false, service: true });
  });
  it('is stable SECURITY INVOKER with an empty search path', async () => {
    const { rows } = await pg.query("select prosecdef, provolatile, proconfig from pg_proc where oid='public.get_fraud_stats_aggregate()'::regprocedure");
    expect(rows[0]).toEqual({ prosecdef: false, provolatile: 's', proconfig: ['search_path=""'] });
  });
  it('reads the existing service-role RLS-visible rows', async () => {
    await seed([0.2, 0.8]);
    await pg.exec('set role service_role');
    try { expect((await rpcStats()).total).toBe(2); } finally { await pg.exec('reset role'); }
  });
  it('does not bypass a restricting table policy', async () => {
    await seed([0.2, 0.8]);
    await pg.exec('alter policy fraud_risk_scores_service_policy on public.fraud_risk_scores using (risk_score < 0.5); set role service_role');
    try { expect((await rpcStats()).total).toBe(1); } finally {
      await pg.exec('reset role; alter policy fraud_risk_scores_service_policy on public.fraud_risk_scores using (true)');
    }
  });
  it('reapplies without changing existing table policies', async () => {
    const before = await pg.query("select policyname, roles, qual, with_check from pg_policies where tablename='fraud_risk_scores' order by policyname");
    await pg.exec(migration);
    expect((await pg.query("select policyname, roles, qual, with_check from pg_policies where tablename='fraud_risk_scores' order by policyname")).rows).toEqual(before.rows);
  });
});
