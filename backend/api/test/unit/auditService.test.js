import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() { return global.__auditSupabase; },
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { createSupabaseMock } = await import('../helpers/supabaseMock.js');
const audit = await import('../../src/services/auditService.js');
const { AUDIT_EVENTS } = await import('../../src/lib/auditEventTypes.js');

describe('auditService', () => {
  beforeEach(async () => {
    global.__auditSupabase = createSupabaseMock({}).supabase;
    await audit.stopAuditFlushTimer();
  });
  afterEach(async () => { await audit.stopAuditFlushTimer(); });

  it('queueAuditLog enriches with id, severity, defaults, and timestamp', async () => {
    audit.queueAuditLog({ eventType: AUDIT_EVENTS.ORDER_CREATED, userId: 'u1' });
    for (let i = 0; i < 50; i++) audit.queueAuditLog({ eventType: AUDIT_EVENTS.BID_PLACED });
    await new Promise((r) => setTimeout(r, 50));
    const res = await audit.queryAuditLogs({ limit: 5 });
    expect(res).toHaveProperty('logs');
    expect(res.logs[0].id).toMatch(/^log_/);
    expect(res.logs[0].timestamp).toBeTruthy();
  });

  it('severity comes from the event map; unknown events are info', async () => {
    audit.queueAuditLog({ eventType: AUDIT_EVENTS.ESCROW_DISPUTED, userId: 'u9' });
    for (let i = 0; i < 50; i++) audit.queueAuditLog({ eventType: AUDIT_EVENTS.ORDER_CREATED });
    await new Promise((r) => setTimeout(r, 100));
    const res = await audit.queryAuditLogs({ severity: 'critical' });
    for (const l of res.logs) expect(l.severity).toBe('critical');
  });

  it('batches are HMAC-signed (batch_signature present and stable per batch)', async () => {
    for (let i = 0; i < 50; i++) audit.queueAuditLog({ eventType: AUDIT_EVENTS.ORDER_CREATED, userId: 'u1' });
    await new Promise((r) => setTimeout(r, 100));
    const res = await audit.queryAuditLogs({ limit: 50 });
    expect(res.logs.length).toBeGreaterThan(0);
    const sigs = new Set(res.logs.map((l) => l.batch_signature));
    expect(sigs.size).toBe(1, 'one batch = one signature');
    expect([...sigs][0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('flush with no admin client is a no-op (no throw)', async () => {
    global.__auditSupabase = null;
    audit.queueAuditLog({ eventType: AUDIT_EVENTS.ORDER_CREATED });
    for (let i = 0; i < 50; i++) audit.queueAuditLog({ eventType: AUDIT_EVENTS.ORDER_CREATED });
    await new Promise((r) => setTimeout(r, 50));
  });

  it('queryAuditLogs filters by userId/eventType and paginates', async () => {
    audit.queueAuditLog({ eventType: AUDIT_EVENTS.BID_PLACED, userId: 'driver-1' });
    audit.queueAuditLog({ eventType: AUDIT_EVENTS.BID_PLACED, userId: 'driver-2' });
    for (let i = 0; i < 50; i++) audit.queueAuditLog({ eventType: AUDIT_EVENTS.ORDER_CREATED });
    await new Promise((r) => setTimeout(r, 100));
    const res = await audit.queryAuditLogs({ userId: 'driver-1' });
    for (const l of res.logs) expect(l.user_id).toBe('driver-1');
  });

  it('exports all rows across pages instead of truncating at the query clamp', async () => {
    const rows = Array.from({ length: 1500 }, (_, index) => ({ id: `log-${index}` }));
    const ranges = [];
    const builder = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      lte: () => builder,
      order: () => builder,
      range: (from, to) => {
        ranges.push([from, to]);
        return Promise.resolve({
          data: rows.slice(from, to + 1),
          error: null,
          count: rows.length,
        });
      },
    };
    global.__auditSupabase = { from: () => builder };

    const exported = JSON.parse(await audit.exportAuditLogsJSON({ userId: 'u1' }));

    expect(exported).toHaveLength(1500);
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
  });

  it('caps an export at MAX_AUDIT_EXPORT_ROWS', async () => {
    const rows = Array.from(
      { length: audit.MAX_AUDIT_EXPORT_ROWS + 500 },
      (_, index) => ({ id: `log-${index}` }),
    );
    const ranges = [];
    const builder = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      lte: () => builder,
      order: () => builder,
      range: (from, to) => {
        ranges.push([from, to]);
        return Promise.resolve({
          data: rows.slice(from, to + 1),
          error: null,
          count: rows.length,
        });
      },
    };
    global.__auditSupabase = { from: () => builder };

    const exported = JSON.parse(await audit.exportAuditLogsJSON({}));

    expect(exported).toHaveLength(audit.MAX_AUDIT_EXPORT_ROWS);
    expect(ranges).toHaveLength(10);
    expect(ranges[9]).toEqual([9000, 9999]);
  });

  it('the flush timer flushes on the interval and stopAuditFlushTimer cleans up', async () => {
    audit.startAuditFlushTimer();
    audit.queueAuditLog({ eventType: AUDIT_EVENTS.ORDER_CREATED, userId: 'timer-user' });
    await new Promise((r) => setTimeout(r, 2300));
    const res = await audit.queryAuditLogs({ userId: 'timer-user' });
    expect(res.logs.length).toBeGreaterThan(0);
    await audit.stopAuditFlushTimer();
  }, 8000);
});
