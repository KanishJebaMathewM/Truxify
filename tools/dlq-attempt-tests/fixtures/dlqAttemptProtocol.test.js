// Materialized as backend/api/test/unit/dlqAttemptProtocol.test.js by run.sh.
// PGlite is isolated in this locked tool; ordinary API unit discovery needs no new dependency.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({ client: null }));
vi.mock('../../src/config/db.js', () => ({ get supabaseAdmin() { return state.client; }, supabase: null }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { dlqService } from '../../src/services/webhook/dlqService.js';
let pg;
let client;
const id = '00000000-0000-4000-8000-000000000001';
const migration = readFileSync(new URL('../../../../supabase/migrations/20261002164243_webhook_dlq_attempt_fencing.sql', import.meta.url), 'utf8');
const protocolArgs = {
  claim_webhook_failure_batch: ['p_worker_id', 'p_batch_size', 'p_lease_seconds', 'p_max_attempts'],
  admit_webhook_failure_attempt: ['p_event_id', 'p_worker_id', 'p_attempt_count', 'p_lease_seconds'],
  settle_webhook_failure_attempt: ['p_event_id', 'p_worker_id', 'p_attempt_count', 'p_status', 'p_retry_count', 'p_next_retry_at', 'p_error_message'],
};
async function seed(eventId = id) {
  await pg.query("INSERT INTO webhook_failures(id,provider,event_type,payload) VALUES($1,'fixture','example','{}')", [eventId]);
}
async function claim(worker = 'worker') {
  return (await dlqService.claimBatch({ workerId: worker }))[0];
}
async function row(eventId = id) { return (await pg.query('SELECT * FROM webhook_failures WHERE id=$1', [eventId])).rows[0]; }
async function expire(eventId = id) { await pg.query("UPDATE webhook_failures SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [eventId]); }
async function settle(kind, event, worker = 'worker') {
  if (kind === 'complete') return dlqService.completeClaim(event.id, worker, event.attempt_count);
  if (kind === 'retry') return dlqService.requeueClaim(event.id, worker, 1, new Date(Date.now() + 300000).toISOString(), new Error('retry'), event.attempt_count);
  return dlqService.failClaim(event.id, worker, 4, new Error('terminal'), event.attempt_count);
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;");
  for (const f of ['20260710000000_create_webhook_failures.sql', '20260807000000_make_webhook_dlq_crash_safe.sql']) {
    await pg.exec(readFileSync(new URL(`../../../../supabase/migrations/${f}`, import.meta.url), 'utf8'));
  }
  await pg.exec('GRANT USAGE ON SCHEMA public TO service_role; GRANT SELECT, UPDATE ON public.webhook_failures TO service_role;');
  await pg.exec(migration);
}, 30000);

beforeEach(async () => {
  await pg.exec('RESET ROLE; TRUNCATE webhook_failures;');
  client = {
    rpc: vi.fn(async (name, params) => {
      const args = protocolArgs[name];
      if (!args) throw new Error(`Unexpected RPC ${name}`);
      try {
        const result = await pg.query(`SELECT * FROM public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args.map(k => params[k]));
        return { data: name === 'claim_webhook_failure_batch' ? result.rows : result.rows[0][name], error: null };
      } catch (error) { return { data: null, error }; }
    }),
    // Baseline PostgREST updates execute actual SQL, so red/green tests do not
    // fail merely because the former service used a different client method.
    from: vi.fn(() => {
      let patch;
      const filters = [];
      return {
        update(value) { patch = value; return this; },
        eq(key, value) { filters.push([key, value]); return this; },
        async select() {
          if (!patch) return { count: 0, error: null };
          const values = Object.values(patch);
          const sets = Object.keys(patch).map((key, i) => `${key}=$${i + 1}`);
          const where = filters.map(([key, value]) => { values.push(value); return `${key}=$${values.length}`; });
          const result = await pg.query(`UPDATE webhook_failures SET ${sets.join(',')} WHERE ${where.join(' AND ')} RETURNING id`, values);
          return { data: result.rows, error: null };
        },
      };
    }),
  };
  state.client = client;
  vi.spyOn(dlqService, 'logBacklogIfNeeded').mockResolvedValue();
  await seed();
});
afterAll(async () => { vi.restoreAllMocks(); await pg.close(); });

describe('actual service with PostgreSQL attempt protocol', () => {
  for (const kind of ['complete', 'retry', 'fail']) {
    it(`${kind} rejects expired settlement without a successor`, async () => {
      const event = await claim(); await expire();
      expect(await settle(kind, event)).toBe(false);
      expect((await row()).status).toBe('processing');
    });
    it(`${kind} rejects the previous generation after same-worker reclaim`, async () => {
      const old = await claim(); await expire(); const next = await claim();
      expect(next.attempt_count).toBe(old.attempt_count + 1);
      expect(await settle(kind, old)).toBe(false);
      expect((await row()).attempt_count).toBe(next.attempt_count);
      expect((await row()).status).toBe('processing');
    });
    it(`${kind} accepts a live exact attempt and clears ownership`, async () => {
      const event = await claim(); expect(await settle(kind, event)).toBe(true);
      const current = await row();
      expect(current.status).toBe({ complete: 'resolved', retry: 'pending', fail: 'failed_permanently' }[kind]);
      expect([current.claimed_by, current.claimed_at, current.lease_expires_at]).toEqual([null, null, null]);
      expect(await settle(kind, event)).toBe(false);
    });
  }
  it('rejects another worker and missing/invalid attempts without an unsafe fallback', async () => {
    const event = await claim();
    expect(await settle('complete', event, 'other')).toBe(false);
    for (const generation of [undefined, null, 0, -1, 1.5, '1', NaN, Infinity]) {
      expect(await settle('complete', { ...event, attempt_count: generation })).toBe(false);
    }
    expect((await row()).status).toBe('processing');
  });
  it('rejects an absent lease and absent row', async () => {
    const event = await claim(); await pg.exec('UPDATE webhook_failures SET lease_expires_at=NULL');
    expect(await settle('complete', event)).toBe(false);
    expect(await settle('complete', { ...event, id: '00000000-0000-4000-8000-000000000099' })).toBe(false);
  });
  it('admission renews only the live generation', async () => {
    const event = await claim();
    await pg.exec("UPDATE webhook_failures SET lease_expires_at=clock_timestamp()+interval '2 seconds'");
    expect(await dlqService.admitClaim(event, 'worker', 300000)).toBe(true);
    const remaining = (await pg.query('SELECT extract(epoch from lease_expires_at-clock_timestamp()) AS seconds FROM webhook_failures')).rows[0].seconds;
    expect(Number(remaining)).toBeGreaterThan(290);
    await expire(); const next = await claim();
    expect(await dlqService.admitClaim(event, 'worker', 300000)).toBe(false);
    expect(await dlqService.admitClaim(next, 'other', 300000)).toBe(false);
  });
  it('skips a successor-owned queued item before invoking its handler', async () => {
    await seed('00000000-0000-4000-8000-000000000002');
    const events = await dlqService.claimBatch({ workerId: 'worker' });
    const originalRpc = client.rpc.getMockImplementation();
    client.rpc.mockImplementation((name, args) => name === 'claim_webhook_failure_batch' ? { data: events, error: null } : originalRpc(name, args));
    const handler = vi.fn(async () => {
      await expire(events[1].id);
      await pg.query("SELECT * FROM claim_webhook_failure_batch('worker',1,300,25)");
    });
    const result = await dlqService.processQueue({ fixture: handler }, { workerId: 'worker' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ claimed: 2, resolved: 1, retried: 0, failed: 0, lost: 1 });
    expect((await row(events[1].id)).status).toBe('processing');
  });
  it('counts expiry during handler as lost settlement without replaying the handler', async () => {
    const handler = vi.fn(async () => expire());
    expect(await dlqService.processQueue({ fixture: handler }, { workerId: 'worker' })).toEqual({ claimed: 1, resolved: 0, retried: 0, failed: 0, lost: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it('RPC failure/malformed success never admits processing', async () => {
    const event = await claim();
    for (const result of [{ data: null, error: new Error('unavailable') }, { data: [], error: null }, { data: 'true', error: null }]) {
      client.rpc.mockResolvedValueOnce(result);
      expect(await dlqService.admitClaim(event, 'worker', 300000)).toBe(false);
    }
    client.rpc.mockRejectedValueOnce(new Error('transport'));
    expect(await dlqService.admitClaim(event, 'worker', 300000)).toBe(false);
  });
  it('rejects invalid direct SQL transition payloads', async () => {
    const event = await claim();
    for (const status of ['processing', 'anything', null]) {
      const result = await client.rpc('settle_webhook_failure_attempt', { p_event_id: id, p_worker_id: 'worker', p_attempt_count: event.attempt_count, p_status: status, p_retry_count: null, p_next_retry_at: null, p_error_message: null });
      expect(result.data).toBe(false);
    }
    expect((await row()).status).toBe('processing');
  });
  it('service role can settle with existing RLS; public roles cannot execute new RPCs', async () => {
    const event = await claim(); await pg.exec('SET ROLE service_role');
    expect(await settle('complete', event)).toBe(true);
    await pg.exec('RESET ROLE');
    for (const role of ['anon', 'authenticated']) {
      const result = await pg.query("SELECT has_function_privilege($1, 'public.admit_webhook_failure_attempt(uuid,text,integer,integer)', 'EXECUTE') AS admit, has_function_privilege($1, 'public.settle_webhook_failure_attempt(uuid,text,integer,text,integer,timestamptz,text)', 'EXECUTE') AS settle", [role]);
      expect(result.rows[0]).toEqual({ admit: false, settle: false });
    }
  });
  it('migration reapplication preserves rows and claim function', async () => {
    const event = await claim(); await pg.exec(migration);
    expect((await row()).attempt_count).toBe(event.attempt_count);
    expect(await settle('complete', event)).toBe(true);
  });
  it('database clock rejects expiry even inside an earlier-started transaction', async () => {
    const event = await claim();
    await pg.exec('BEGIN');
    try {
      await pg.exec("UPDATE webhook_failures SET lease_expires_at=clock_timestamp()+interval '10 milliseconds'; SELECT pg_sleep(0.02);");
      expect(await settle('complete', event)).toBe(false);
    } finally { await pg.exec('ROLLBACK'); }
  });
});
