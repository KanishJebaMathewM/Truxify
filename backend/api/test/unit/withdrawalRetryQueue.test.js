import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const admin = {
  from: vi.fn(),
  rpc: vi.fn(),
};

vi.mock('../../src/config/db.js', () => ({
  
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
  supabaseAdmin: admin,
}));

const dispatchPayoutMock = vi.fn();
const isPayoutProviderConfiguredMock = vi.fn();

vi.mock('../../src/services/wallet/payoutProvider.js', () => ({
  dispatchPayout: dispatchPayoutMock,
  isPayoutProviderConfigured: isPayoutProviderConfiguredMock,
  recoverSettlementRef: vi.fn(),
}));

const sendPushNotificationMock = vi.fn().mockResolvedValue({ success: true });
vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification: sendPushNotificationMock,
}));

vi.mock('../../src/core/telemetry/WorkerTracer.js', () => ({
  WorkerTracer: {
    wrapIntervalWorker: vi.fn(() => async () => {}),
  },
}));

const {
  settlePendingWithdrawals,
  calculateBackoffDelaySeconds,
  isAmbiguousDispatchError,
} = await import('../../src/workers/withdrawalSettlementWorker.js');

function mockPendingWithdrawals(rows) {
  const selectQuery = {
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  const updateQuery = {
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue({
      data: [{ id: 'w-timeout-1' }, { id: 'w-dlq-1' }, { id: 'w-success-1' }, { id: 'w1' }],
      error: null,
    }),
  };
  admin.from.mockImplementation(() => ({
    select: vi.fn().mockReturnValue(selectQuery),
    update: vi.fn().mockReturnValue(updateQuery),
  }));
}

describe('Withdrawal Retry Queue & DLQ Processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    isPayoutProviderConfiguredMock.mockReturnValue(true);
    admin.rpc.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Exponential Backoff Calculator', () => {
    it('computes exponential delays starting at 60s and caps at 3600s', () => {
      expect(calculateBackoffDelaySeconds(0)).toBe(60);
      expect(calculateBackoffDelaySeconds(1)).toBe(120);
      expect(calculateBackoffDelaySeconds(2)).toBe(240);
      expect(calculateBackoffDelaySeconds(3)).toBe(480);
      expect(calculateBackoffDelaySeconds(4)).toBe(960);
      expect(calculateBackoffDelaySeconds(5)).toBe(1920);
      expect(calculateBackoffDelaySeconds(6)).toBe(3600); // capped at 3600
      expect(calculateBackoffDelaySeconds(10)).toBe(3600); // capped at 3600
    });
  });

  describe('Ambiguous Error Classification', () => {
    it('correctly identifies transient gateway/network errors as ambiguous', () => {
      expect(isAmbiguousDispatchError(new Error('ETIMEDOUT connecting to payment gateway'))).toBe(true);
      expect(isAmbiguousDispatchError(new Error('Gateway returned 502 Bad Gateway'))).toBe(true);
      expect(isAmbiguousDispatchError(new Error('socket hang up'))).toBe(true);
      expect(isAmbiguousDispatchError(new Error('ECONNRESET'))).toBe(true);
      expect(isAmbiguousDispatchError(new Error('Invalid bank account number'))).toBe(false);
      expect(isAmbiguousDispatchError(new Error('Insufficient platform balance'))).toBe(false);
    });
  });

  describe('Retry Scheduling with Exponential Backoff', () => {
    it('schedules an exponential retry and notifies driver when an ambiguous timeout occurs', async () => {
      mockPendingWithdrawals([
        {
          id: 'w-timeout-1',
          driver_id: 'd-1',
          amount: 5000,
          payout_attempted_at: null,
          retry_count: 1,
          max_retries: 5,
          next_retry_at: new Date(Date.now() - 1000).toISOString(),
        },
      ]);

      dispatchPayoutMock.mockRejectedValue(new Error('Request timed out'));

      await settlePendingWithdrawals();

      expect(admin.rpc).toHaveBeenCalledWith('schedule_withdrawal_retry', {
        p_withdrawal_id: 'w-timeout-1',
        p_error: 'Request timed out',
        p_delay_seconds: 120, // 60 * 2^1 = 120
      });

      expect(sendPushNotificationMock).toHaveBeenCalledWith(
        'd-1',
        'Withdrawal Retrying',
        expect.stringContaining('temporary delay'),
        'payment',
        expect.objectContaining({ withdrawal_id: 'w-timeout-1', status: 'retrying' })
      );

      expect(admin.rpc).not.toHaveBeenCalledWith('fail_withdrawal_tx', expect.anything());
    });
  });

  describe('Dead-Letter Queue (DLQ) Transition', () => {
    it('transitions to DLQ and alerts driver when max retries are exceeded', async () => {
      mockPendingWithdrawals([
        {
          id: 'w-dlq-1',
          driver_id: 'd-2',
          amount: 10000,
          payout_attempted_at: null,
          retry_count: 5,
          max_retries: 5,
          next_retry_at: new Date(Date.now() - 1000).toISOString(),
        },
      ]);

      dispatchPayoutMock.mockRejectedValue(new Error('Gateway 504 Gateway Timeout'));

      await settlePendingWithdrawals();

      expect(admin.rpc).toHaveBeenCalledWith('move_withdrawal_to_dlq', {
        p_withdrawal_id: 'w-dlq-1',
        p_reason: expect.stringContaining('Exceeded max retries (5)'),
      });

      expect(sendPushNotificationMock).toHaveBeenCalledWith(
        'd-2',
        'Withdrawal Under Review',
        expect.stringContaining('operations team'),
        'payment',
        expect.objectContaining({ withdrawal_id: 'w-dlq-1', status: 'under_review' })
      );
    });
  });

  describe('Skipping Future Retries', () => {
    it('skips withdrawals whose next_retry_at is scheduled in the future', async () => {
      mockPendingWithdrawals([
        {
          id: 'w-future-1',
          driver_id: 'd-3',
          amount: 2000,
          payout_attempted_at: null,
          retry_count: 2,
          next_retry_at: new Date(Date.now() + 60000).toISOString(), // 1 minute in future
        },
      ]);

      await settlePendingWithdrawals();

      expect(dispatchPayoutMock).not.toHaveBeenCalled();
      expect(admin.rpc).not.toHaveBeenCalled();
    });
  });

  describe('Successful Settlement Notification', () => {
    it('sends completed push notification when withdrawal settles successfully', async () => {
      mockPendingWithdrawals([
        {
          id: 'w-success-1',
          driver_id: 'd-4',
          amount: 250000, // Rs 2500.00
          payout_attempted_at: null,
        },
      ]);

      dispatchPayoutMock.mockResolvedValue({ success: true, settlementRef: 'settle-ref-99' });

      await settlePendingWithdrawals();

      expect(admin.rpc).toHaveBeenCalledWith('settle_withdrawal_tx', {
        p_withdrawal_id: 'w-success-1',
        p_settlement_ref: 'settle-ref-99',
      });

      expect(sendPushNotificationMock).toHaveBeenCalledWith(
        'd-4',
        'Withdrawal Completed',
        expect.stringContaining('processed'),
        'payment',
        expect.objectContaining({ withdrawal_id: 'w-success-1', status: 'completed' })
      );
    });
  });
});
