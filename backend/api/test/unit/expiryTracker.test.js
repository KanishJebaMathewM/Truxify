import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() { return global.__etSupabase; },
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { createSupabaseMock } = await import('../helpers/supabaseMock.js');
const {
  findExpiringDocuments,
  markAlertSent,
  getExpiredDocuments,
  checkDriverCompliance,
  runExpiryCheckJob,
} = await import('../../src/lib/expiryTracker.js');

const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().split('T')[0];

describe('expiryTracker', () => {
  beforeEach(() => { global.__etSupabase = null; });

  it('findExpiringDocuments tags each hit with its threshold', async () => {
    const mock = createSupabaseMock({
      driver_documents: [
        { id: 'doc-30', driver_id: 'd1', document_type: 'DL', document_number: 'X', expiry_date: inDays(30), status: 'verified', alert_sent_30_days: false, alert_sent_7_days: false, alert_sent_1_days: false },
      ],
    });
    global.__etSupabase = mock.supabase;
    const alerts = await findExpiringDocuments();
    const dl = alerts.find((a) => a.id === 'doc-30');
    expect(dl.alertThreshold).toBe(30);
    expect(dl.daysUntilExpiry).toBe(30);
  });

  it('documents already alerted at a threshold are not re-alerted (flag column filter)', async () => {
    const mock = createSupabaseMock({
      driver_documents: [
        { id: 'doc-done', driver_id: 'd1', document_type: 'DL', document_number: 'X', expiry_date: inDays(30), status: 'verified', alert_sent_30_days: true, alert_sent_7_days: false, alert_sent_1_days: false },
      ],
    });
    global.__etSupabase = mock.supabase;
    const alerts = await findExpiringDocuments();
    expect(alerts.find((a) => a.id === 'doc-done' && a.alertThreshold === 30)).toBeUndefined();
  });

  it('supabaseAdmin unset → empty list, no throw', async () => {
    expect(await findExpiringDocuments()).toEqual([]);
  });

  it('markAlertSent flips the threshold flag and stamps last_alert_sent_at', async () => {
    const mock = createSupabaseMock({
      driver_documents: [
        { id: 'doc-7', driver_id: 'd1', document_type: 'RC', document_number: 'Y', expiry_date: inDays(7), status: 'verified', alert_sent_7_days: false },
      ],
    });
    global.__etSupabase = mock.supabase;
    await markAlertSent('doc-7', 7);
    const row = mock.store.driver_documents.find((r) => r.id === 'doc-7');
    expect(row.alert_sent_7_days).toBe(true);
    expect(row.last_alert_sent_at).toBeTruthy();
  });

  it('getExpiredDocuments returns only past-expired verified docs', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const mock = createSupabaseMock({
      driver_documents: [
        { id: 'expired', driver_id: 'd1', document_type: 'DL', document_number: 'X', expiry_date: yesterday, status: 'verified' },
        { id: 'valid', driver_id: 'd1', document_type: 'RC', document_number: 'Y', expiry_date: inDays(90), status: 'verified' },
      ],
    });
    global.__etSupabase = mock.supabase;
    const res = await getExpiredDocuments('d1');
    expect(res.map((d) => d.id)).toEqual(['expired']);
  });

  it('checkDriverCompliance flips on expired docs', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const mock = createSupabaseMock({
      driver_documents: [
        { id: 'expired', driver_id: 'd1', document_type: 'DL', document_number: 'X', expiry_date: yesterday, status: 'verified' },
      ],
    });
    global.__etSupabase = mock.supabase;
    const res = await checkDriverCompliance('d1');
    expect(res.compliant).toBe(false);
    expect(res.expiredDocs).toHaveLength(1);
    expect(res.checkedAt).toBeTruthy();
  });

  it('runExpiryCheckJob calls the alert fn per document and marks each sent', async () => {
    const mock = createSupabaseMock({
      driver_documents: [
        { id: 'doc-30', driver_id: 'd1', document_type: 'DL', document_number: 'X', expiry_date: inDays(30), status: 'verified', alert_sent_30_days: false, alert_sent_7_days: false, alert_sent_1_days: false, driver: { full_name: 'Ram', phone: '9' } },
      ],
    });
    global.__etSupabase = mock.supabase;
    const sent = [];
    await runExpiryCheckJob(async (payload) => sent.push(payload));
    expect(sent).toHaveLength(1);
    expect(sent[0].driverId).toBe('d1');
    expect(sent[0].daysUntilExpiry).toBe(30);
    const row = mock.store.driver_documents.find((r) => r.id === 'doc-30');
    expect(row.alert_sent_30_days).toBe(true);
  });

  it('runExpiryCheckJob survives a failing alert fn and does NOT mark the doc as alerted (retry next cycle)', async () => {
    const mock = createSupabaseMock({
      driver_documents: [
        { id: 'doc-x', driver_id: 'd1', document_type: 'DL', document_number: 'X', expiry_date: inDays(30), status: 'verified', alert_sent_30_days: false, alert_sent_7_days: false, alert_sent_1_days: false },
      ],
    });
    global.__etSupabase = mock.supabase;
    await runExpiryCheckJob(async () => { throw new Error('sms gateway down'); });
    // the throw skips markAlertSent inside the same try — the alert is NOT
    // marked sent, so the next scheduled run retries it (correct: a failed
    // send must not be recorded as sent)
    const row = mock.store.driver_documents.find((r) => r.id === 'doc-x');
    expect(row.alert_sent_30_days).toBe(false);
  });
});
