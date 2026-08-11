import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const admin = {
  from: vi.fn(),
  rpc: vi.fn(),
};

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: admin,
}));

const dispatchPayoutMock = vi.fn();
const isPayoutProviderConfiguredMock = vi.fn();

vi.mock('../../src/services/wallet/payoutProvider.js', () => ({
  dispatchPayout: dispatchPayoutMock,
  isPayoutProviderConfigured: isPayoutProviderConfiguredMock,
}));

vi.mock('../../src/core/telemetry/WorkerTracer.js', () => ({
  WorkerTracer: {
    wrapIntervalWorker: vi.fn(() => async () => {}),
  },
}));

const { settlePendingWithdrawals } = await import('../../src/workers/withdrawalSettlementWorker.js');

function mockPendingWithdrawals(rows) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    update: vi.fn().mockReturnThis(),
  };
  admin.from.mockReturnValue(query);
  return query;
}

describe('Withdrawal Settlement Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    isPayoutProviderConfiguredMock.mockReturnValue(true);
    admin.rpc.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips the cycle when no payout provider is configured', async () => {
    isPayoutProviderConfiguredMock.mockReturnValue(false);

    await settlePendingWithdrawals();

    expect(admin.from).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it('settles pending withdrawals through the payout provider', async () => {
    mockPendingWithdrawals([
      { id: 'w1', driver_id: 'd1', amount: 1000, payout_attempted_at: null },
      { id: 'w2', driver_id: 'd2', amount: 500, payout_attempted_at: null },
    ]);
    dispatchPayoutMock
      .mockResolvedValueOnce({ success: true, settlementRef: 'ref-1' })
      .mockResolvedValueOnce({ success: true, settlementRef: 'ref-2' });

    await settlePendingWithdrawals();

    expect(dispatchPayoutMock).toHaveBeenCalledTimes(2);
    expect(admin.rpc).toHaveBeenCalledWith('settle_withdrawal_tx', {
      p_withdrawal_id: 'w1',
      p_settlement_ref: 'ref-1',
    });
    expect(admin.rpc).toHaveBeenCalledWith('settle_withdrawal_tx', {
      p_withdrawal_id: 'w2',
      p_settlement_ref: 'ref-2',
    });
    expect(admin.rpc).not.toHaveBeenCalledWith('fail_withdrawal_tx', expect.anything());
  });

  it('marks a withdrawal failed and restores funds when the payout dispatch fails', async () => {
    mockPendingWithdrawals([{ id: 'w1', driver_id: 'd1', amount: 1000, payout_attempted_at: null }]);
    dispatchPayoutMock.mockRejectedValue(new Error('bank rejected'));

    await settlePendingWithdrawals();

    expect(admin.rpc).toHaveBeenCalledWith('fail_withdrawal_tx', {
      p_withdrawal_id: 'w1',
      p_error: 'bank rejected',
    });
    expect(admin.rpc).not.toHaveBeenCalledWith('settle_withdrawal_tx', expect.anything());
  });

  it('does not restore funds when settle fails after a successful dispatch', async () => {
    vi.useFakeTimers();
    mockPendingWithdrawals([{ id: 'w1', driver_id: 'd1', amount: 1000, payout_attempted_at: null }]);
    dispatchPayoutMock.mockResolvedValue({ success: true, settlementRef: 'ref-1' });
    admin.rpc.mockImplementation((name) =>
      name === 'settle_withdrawal_tx'
        ? Promise.resolve({ error: { message: 'rpc timeout' } })
        : Promise.resolve({ error: null })
    );

    const running = settlePendingWithdrawals();
    await vi.advanceTimersByTimeAsync(6000);
    await running;

    // The payout was dispatched — funds must NEVER be restored via
    // fail_withdrawal_tx.
    expect(admin.rpc).not.toHaveBeenCalledWith('fail_withdrawal_tx', expect.anything());
    // The idempotent settle call is retried with a bounded backoff.
    const settleCalls = admin.rpc.mock.calls.filter(([name]) => name === 'settle_withdrawal_tx');
    expect(settleCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('does not re-dispatch a withdrawal whose payout was already attempted', async () => {
    mockPendingWithdrawals([
      { id: 'w1', driver_id: 'd1', amount: 1000, payout_attempted_at: '2026-08-04T10:00:00Z', settlement_ref: 'ref-1' },
    ]);

    await settlePendingWithdrawals();

    expect(dispatchPayoutMock).not.toHaveBeenCalled();
    expect(admin.rpc).toHaveBeenCalledWith('settle_withdrawal_tx', {
      p_withdrawal_id: 'w1',
      p_settlement_ref: 'ref-1',
    });
    expect(admin.rpc).not.toHaveBeenCalledWith('fail_withdrawal_tx', expect.anything());
  });

  it('does not settle anything when the pending query errors', async () => {
    admin.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } }),
    });

    await settlePendingWithdrawals();

    expect(dispatchPayoutMock).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});
