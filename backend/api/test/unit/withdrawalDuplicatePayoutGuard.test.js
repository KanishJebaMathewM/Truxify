import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Regression tests for the duplicate-payout bug in the withdrawal retry path.
 *
 * schedule_withdrawal_retry (ambiguous failure) and admin_resolve_dlq_withdrawal
 * ('retry') both reset payout_attempted_at to NULL, so the next sweep re-claimed
 * the row and called dispatchPayout again - without asking the provider whether
 * the first, ambiguous attempt had already paid the driver.
 */

const admin = { from: vi.fn(), rpc: vi.fn() };

vi.mock('../../src/config/db.js', () => ({
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
  supabaseAdmin: admin,
  supabase: {},
}));

const dispatchPayoutMock = vi.fn();
const lookupPayoutStatusMock = vi.fn();

vi.mock('../../src/services/wallet/payoutProvider.js', () => ({
  dispatchPayout: (...a) => dispatchPayoutMock(...a),
  isPayoutProviderConfigured: () => true,
  recoverSettlementRef: vi.fn().mockResolvedValue(null),
  lookupPayoutStatus: (...a) => lookupPayoutStatusMock(...a),
}));

vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../../src/core/telemetry/WorkerTracer.js', () => ({
  WorkerTracer: { wrapIntervalWorker: vi.fn(() => async () => {}) },
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info() {}, warn() {}, error() {}, debug() {} },
}));

const { settlePendingWithdrawals } = await import('../../src/workers/withdrawalSettlementWorker.js');

let updates;

function mockPendingWithdrawals(rows) {
  updates = [];
  const selectQuery = {
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  admin.from.mockImplementation(() => ({
    select: vi.fn().mockReturnValue(selectQuery),
    update: vi.fn((patch) => {
      updates.push(patch);
      const q = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({ data: [{ id: rows[0].id }], error: null }),
      };
      // recordDispatchOutcome awaits the builder directly (no .select()).
      q.then = (resolve) => resolve({ error: null });
      return q;
    }),
  }));
}

const retriedRow = (overrides = {}) => ({
  id: 'w-1',
  driver_id: 'd-1',
  amount: 5000,
  payout_attempted_at: null, // reset by schedule_withdrawal_retry
  settlement_ref: null,
  retry_count: 1,
  max_retries: 5,
  settlement_error: 'Payout webhook did not respond within 15000ms.',
  next_retry_at: new Date(Date.now() - 1000).toISOString(),
  ...overrides,
});

describe('withdrawal retry never double-pays', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    admin.rpc.mockResolvedValue({ error: null });
  });
  afterEach(() => vi.useRealTimers());

  it('adopts the existing payout and does NOT dispatch again when the provider already paid', async () => {
    mockPendingWithdrawals([retriedRow()]);
    lookupPayoutStatusMock.mockResolvedValue({ state: 'found', settlementRef: 'prov-ref-1' });

    await settlePendingWithdrawals();

    expect(lookupPayoutStatusMock).toHaveBeenCalledWith({ withdrawalId: 'w-1' });
    expect(dispatchPayoutMock).not.toHaveBeenCalled();
    expect(updates).toContainEqual({ settlement_ref: 'prov-ref-1' });
    expect(admin.rpc).toHaveBeenCalledWith('settle_withdrawal_tx', {
      p_withdrawal_id: 'w-1',
      p_settlement_ref: 'prov-ref-1',
    });
    expect(admin.rpc).not.toHaveBeenCalledWith('fail_withdrawal_tx', expect.anything());
  });

  it('fails closed (no claim, no dispatch) when the provider status lookup is inconclusive', async () => {
    mockPendingWithdrawals([retriedRow()]);
    lookupPayoutStatusMock.mockResolvedValue({ state: 'unknown', error: 'HTTP 503' });

    await settlePendingWithdrawals();

    expect(dispatchPayoutMock).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0); // row left untouched for the next sweep
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it('fails closed when the lookup itself throws', async () => {
    mockPendingWithdrawals([retriedRow()]);
    lookupPayoutStatusMock.mockRejectedValue(new Error('boom'));

    await settlePendingWithdrawals();

    expect(dispatchPayoutMock).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('re-dispatches only when the provider affirmatively reports no payout exists', async () => {
    mockPendingWithdrawals([retriedRow()]);
    lookupPayoutStatusMock.mockResolvedValue({ state: 'not_found' });
    dispatchPayoutMock.mockResolvedValue({ success: true, settlementRef: 'new-ref' });

    await settlePendingWithdrawals();

    expect(dispatchPayoutMock).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith('settle_withdrawal_tx', {
      p_withdrawal_id: 'w-1',
      p_settlement_ref: 'new-ref',
    });
  });

  it('still dispatches when no status endpoint is configured (relies on the idempotency key)', async () => {
    mockPendingWithdrawals([retriedRow()]);
    lookupPayoutStatusMock.mockResolvedValue({ state: 'unsupported' });
    dispatchPayoutMock.mockResolvedValue({ success: true, settlementRef: 'new-ref' });

    await settlePendingWithdrawals();

    expect(dispatchPayoutMock).toHaveBeenCalledTimes(1);
  });

  it('also protects a row requeued by the admin DLQ retry that wiped all attempt evidence', async () => {
    mockPendingWithdrawals([
      retriedRow({ retry_count: 0, settlement_error: null }),
    ]);
    lookupPayoutStatusMock.mockResolvedValue({ state: 'found', settlementRef: 'prov-ref-9' });

    await settlePendingWithdrawals();

    expect(dispatchPayoutMock).not.toHaveBeenCalled();
    expect(admin.rpc).toHaveBeenCalledWith('settle_withdrawal_tx', {
      p_withdrawal_id: 'w-1',
      p_settlement_ref: 'prov-ref-9',
    });
  });
});

describe('payout provider: idempotency + tri-state status lookup', () => {
  const realFetch = global.fetch;
  let providerModule;

  beforeEach(async () => {
    vi.resetModules();
    vi.doUnmock('../../src/services/wallet/payoutProvider.js');
    providerModule = await vi.importActual('../../src/services/wallet/payoutProvider.js');
    process.env.WITHDRAWAL_PAYOUT_WEBHOOK_URL = 'https://payout.example.com/pay';
    process.env.WITHDRAWAL_PAYOUT_STATUS_URL = 'https://payout.example.com/status';
  });
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.WITHDRAWAL_PAYOUT_WEBHOOK_URL;
    delete process.env.WITHDRAWAL_PAYOUT_STATUS_URL;
  });

  it('sends the same deterministic Idempotency-Key on every attempt', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ settlement_ref: 'ref-123' }),
    });

    await providerModule.dispatchPayout({ driverId: 'd', withdrawal: { id: 'abc', amount: 10 } });
    await providerModule.dispatchPayout({ driverId: 'd', withdrawal: { id: 'abc', amount: 10 } });

    const [, first] = global.fetch.mock.calls[0];
    const [, second] = global.fetch.mock.calls[1];
    expect(first.headers['idempotency-key']).toBe('wabc');
    expect(second.headers['idempotency-key']).toBe('wabc');
    expect(JSON.parse(first.body).reference).toBe('wabc');
  });

  it.each([
    [{ ok: true, status: 200, json: async () => ({ settlement_ref: 'ref-1' }) }, 'found'],
    [{ ok: false, status: 404, json: async () => ({}) }, 'not_found'],
    [{ ok: true, status: 200, json: async () => ({ found: false }) }, 'not_found'],
    [{ ok: false, status: 503, json: async () => ({}) }, 'unknown'],
    [{ ok: true, status: 200, json: async () => ({}) }, 'unknown'],
    [{ ok: true, status: 200, json: async () => ({ settlement_ref: 'bad ref!' }) }, 'unknown'],
  ])('classifies provider response %#', async (response, expected) => {
    global.fetch = vi.fn().mockResolvedValue(response);
    const result = await providerModule.lookupPayoutStatus({ withdrawalId: 'abc' });
    expect(result.state).toBe(expected);
  });

  it('reports unknown (not not_found) when the lookup request fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const result = await providerModule.lookupPayoutStatus({ withdrawalId: 'abc' });
    expect(result.state).toBe('unknown');
  });

  it('reports unsupported when no status URL is configured', async () => {
    delete process.env.WITHDRAWAL_PAYOUT_STATUS_URL;
    const result = await providerModule.lookupPayoutStatus({ withdrawalId: 'abc' });
    expect(result.state).toBe('unsupported');
  });

  it('recoverSettlementRef keeps its legacy contract (ref or null)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ settlement_ref: 'ref-1' }) });
    expect(await providerModule.recoverSettlementRef({ withdrawalId: 'abc' })).toBe('ref-1');
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    expect(await providerModule.recoverSettlementRef({ withdrawalId: 'abc' })).toBeNull();
  });
});
