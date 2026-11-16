import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = { rows: [] };
let afterRead = null;

const mockDispatchPayout = vi.fn();

function matches(row, filters) {
  return filters.every(({ type, col, val }) =>
    type === 'is' ? (row[col] ?? null) === (val ?? null) : row[col] === val,
  );
}

function makeBuilder() {
  const filters = [];
  let patch = null;
  let isSelect = false;

  const builder = {
    select() { isSelect = true; return builder; },
    update(p) { patch = p; return builder; },
    eq(col, val) { filters.push({ type: 'eq', col, val }); return builder; },
    is(col, val) { filters.push({ type: 'is', col, val }); return builder; },
    order() { return builder; },
    limit() { return builder; },
    then(resolve, reject) {
      const rows = store.rows.filter((r) => matches(r, filters));
      if (patch) rows.forEach((r) => Object.assign(r, patch));
      // Simulate a concurrent terminal transition landing after the candidate
      // read resolves but before the worker issues its claim.
      if (isSelect && !patch && afterRead) afterRead(store);
      const data = rows.map((r) => ({ ...r }));
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return builder;
}

const fakeAdmin = {
  from() { return makeBuilder(); },
  rpc() { return Promise.resolve({ data: null, error: null }); },
};

vi.mock('../../src/config/db.js', () => ({ supabaseAdmin: fakeAdmin, supabase: {} }));
vi.mock('../../src/services/wallet/payoutProvider.js', () => ({
  dispatchPayout: (...a) => mockDispatchPayout(...a),
  isPayoutProviderConfigured: () => true,
  recoverSettlementRef: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/services/notificationService.js', () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { info() {}, warn() {}, error() {}, debug() {} } }));

const { settlePendingWithdrawals } = await import('../../src/workers/withdrawalSettlementWorker.js');

function makeRow(overrides = {}) {
  return {
    id: 'W-1',
    driver_id: 'D-1',
    amount: 100,
    txn_type: 'withdrawal',
    status: 'pending',
    payout_attempted_at: null,
    settlement_ref: null,
    settled_at: null,
    retry_count: 0,
    max_retries: 3,
    next_retry_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('withdrawal settlement worker — claim race', () => {
  beforeEach(() => {
    store.rows = [makeRow()];
    afterRead = null;
    mockDispatchPayout.mockReset();
    mockDispatchPayout.mockResolvedValue({ settlementRef: 'SR-1' });
  });

  it('does not dispatch a payout when the row leaves pending before the claim', async () => {
    // Concurrent fail_withdrawal_tx-style transition: row goes terminal and the
    // wallet is refunded, but payout_attempted_at stays NULL.
    afterRead = (s) => {
      s.rows[0].status = 'failed';
      s.rows[0].settlement_error = 'payout rejected by provider';
      s.rows[0].wallet_pending = 0;
      s.rows[0].wallet_confirmed = 100;
    };

    await settlePendingWithdrawals();

    // The candidate read saw a pending, unclaimed row, but by claim time it is
    // terminal. The claim must lose, so no money leaves.
    expect(mockDispatchPayout).not.toHaveBeenCalled();
  });

  it('does not claim a withdrawal that becomes settled before the claim', async () => {
    // A candidate at read time (settled_at still NULL so the SELECT filter lets
    // it through), then settles concurrently before the claim UPDATE.
    afterRead = (s) => { s.rows[0].settled_at = new Date().toISOString(); };

    await settlePendingWithdrawals();

    expect(mockDispatchPayout).not.toHaveBeenCalled();
  });

  it('still dispatches and settles on the normal happy path', async () => {
    await settlePendingWithdrawals();

    expect(mockDispatchPayout).toHaveBeenCalledTimes(1);
    // claim set payout_attempted_at, and the dispatch ref was recorded
    expect(store.rows[0].payout_attempted_at).not.toBeNull();
    expect(store.rows[0].settlement_ref).toBe('SR-1');
  });

  it('does not dispatch a second payout when the claim is already held', async () => {
    store.rows[0].payout_attempted_at = new Date().toISOString();
    store.rows[0].settlement_ref = 'SR-existing';

    await settlePendingWithdrawals();

    // Already-claimed rows take the re-settle path, never a fresh dispatch.
    expect(mockDispatchPayout).not.toHaveBeenCalled();
  });
});