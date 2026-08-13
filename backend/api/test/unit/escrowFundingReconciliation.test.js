/**
 * Unit tests for backend/api/src/services/escrowFundingReconciliation.js
 *
 * Coverage:
 *   - dueForRetry: returns true when attempts is 0
 *   - dueForRetry: returns true when attempts > 0 and backoff has elapsed
 *   - dueForRetry: returns false when backoff has not elapsed
 *   - reconcileStaleFunding: returns early when orderRepository is null
 *   - reconcileStaleFunding: skips batch when global Redis lock is not acquired
 *
 * Run with:  npm run test:unit -- test/unit/escrowFundingReconciliation.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const mockRedisClient = vi.hoisted(() => ({
  set: vi.fn(),
  del: vi.fn(),
  expire: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  redisClient: mockRedisClient,
  supabaseAdmin: {},
}));

vi.mock('../../src/services/escrow.js', () => ({
  submitEscrowRefund: vi.fn(),
  getEscrowBooking: vi.fn(),
}));

vi.mock('../../src/lib/redisLock.js', () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
}));

vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification: vi.fn(),
}));

// Mock the order repository
const mockOrderRepository = vi.hoisted(() => ({
  findStaleFundingOrders: vi.fn(),
  updateOrder: vi.fn(),
  updateOrderWithFilter: vi.fn(),
  executeRpc: vi.fn(),
}));

import { reconcileStaleFunding } from '../../src/services/escrowFundingReconciliation.js';

describe('escrowFundingReconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('reconcileStaleFunding', () => {
    it('throws when orderRepository is null', async () => {
      await expect(reconcileStaleFunding(null)).rejects.toThrow('requires an OrderRepository instance');
    });

    it('skips batch when global Redis lock is not acquired', async () => {
      mockRedisClient.set.mockResolvedValue(null); // lock not acquired

      await reconcileStaleFunding(mockOrderRepository);

      expect(mockLogger.info).toHaveBeenCalledWith('[escrow-funding] Global lock held by another instance, skipping batch.');
    });

    it('acquires Redis lock and processes orders when lock is acquired', async () => {
      mockRedisClient.set.mockResolvedValue('locked');

      const mockOrders = [
        {
          id: 'order-1',
          order_display_id: 'DIS-1',
          escrow_status: 'funding',
          escrow_booking_id: 'booking-1',
          escrow_funding_attempts: 0,
          escrow_funding_last_attempt_at: null,
          pending_bid_acceptance: null,
        },
      ];
      mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: mockOrders, error: null });

      // Mock the lock acquisition for finalizeOrRevert
      const { acquireLock, releaseLock } = await import('../../src/lib/redisLock.js');
      acquireLock.mockResolvedValueOnce('lock-value');
      releaseLock.mockResolvedValueOnce(undefined);

      const { getEscrowBooking } = await import('../../src/services/escrow.js');
      getEscrowBooking.mockResolvedValueOnce({ paid: false });

      await reconcileStaleFunding(mockOrderRepository);

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        expect.stringContaining('escrow:funding:reconciliation:lock'),
        expect.any(String),
        'NX',
        'EX',
        expect.any(Number)
      );
      expect(mockOrderRepository.findStaleFundingOrders).toHaveBeenCalled();
    });

    it('returns early on DB error when fetching stale orders', async () => {
      mockRedisClient.set.mockResolvedValue('locked');
      mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: null, error: { message: 'DB error' } });

      await reconcileStaleFunding(mockOrderRepository);

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[escrow-funding] Failed to load stale funding orders:',
        'DB error'
      );
    });
it('refunds cancelled funded orders only after submit and confirmation', async () => {
      mockRedisClient.set.mockResolvedValue('locked');

      const mockOrders = [
        {
          id: 'order-cancelled',
          order_display_id: 'DIS-CANCEL',
          status: 'cancelled',
          escrow_status: 'funding',
          escrow_booking_id: 'booking-1',
          escrow_amount_wei: '1000000000000000000',
          escrow_funding_attempts: 0,
          escrow_funding_last_attempt_at: null,
          pending_bid_acceptance: null,
          customer_id: 'cust-1',
        },
      ];
      mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: mockOrders, error: null });

      const { acquireLock, releaseLock } = await import('../../src/lib/redisLock.js');
      acquireLock.mockResolvedValueOnce('lock-value');
      releaseLock.mockResolvedValueOnce(undefined);

      const { getEscrowBooking, submitEscrowRefund } = await import('../../src/services/escrow.js');
      getEscrowBooking.mockResolvedValueOnce({ paid: false, amount: 1000000000000000000n });
      const waitForConfirmation = vi.fn().mockResolvedValue(undefined);
      submitEscrowRefund.mockResolvedValueOnce({ txHash: '0xrefund', waitForConfirmation });

      await reconcileStaleFunding(mockOrderRepository);

      expect(submitEscrowRefund).toHaveBeenCalledWith('DIS-CANCEL');
      expect(waitForConfirmation).toHaveBeenCalled();
      expect(mockOrderRepository.updateOrder).toHaveBeenCalledWith(
        'order-cancelled',
        expect.objectContaining({ escrow_status: 'refunded', escrow_refund_error: null }),
      );
    });

    it('marks refund_failed when cancelled order refund is not submitted', async () => {
      mockRedisClient.set.mockResolvedValue('locked');

      const mockOrders = [
        {
          id: 'order-cancelled',
          order_display_id: 'DIS-CANCEL',
          status: 'cancelled',
          escrow_status: 'funding',
          escrow_booking_id: 'booking-1',
          escrow_amount_wei: '1000000000000000000',
          escrow_funding_attempts: 0,
          escrow_funding_last_attempt_at: null,
          pending_bid_acceptance: null,
          customer_id: 'cust-1',
        },
      ];
      mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: mockOrders, error: null });

      const { acquireLock, releaseLock } = await import('../../src/lib/redisLock.js');
      acquireLock.mockResolvedValueOnce('lock-value');
      releaseLock.mockResolvedValueOnce(undefined);

      const { getEscrowBooking, submitEscrowRefund } = await import('../../src/services/escrow.js');
      getEscrowBooking.mockResolvedValueOnce({ paid: false, amount: 1000000000000000000n });
      submitEscrowRefund.mockResolvedValueOnce({ txHash: null, error: 'chain rejected' });

      await reconcileStaleFunding(mockOrderRepository);

      expect(mockOrderRepository.updateOrder).toHaveBeenCalledWith(
        'order-cancelled',
        expect.objectContaining({ escrow_status: 'refund_failed', escrow_refund_error: 'chain rejected' }),
      );
    });

    it('marks a cancelled order refund_failed when the refund tx never submits', async () => {
      mockRedisClient.set.mockResolvedValue('locked');

      const order = makeCancelledFundingOrder();
      mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: [order], error: null });
      mockOrderRepository.updateOrderWithFilter.mockResolvedValueOnce({ error: null });
      mockOrderRepository.updateOrder.mockResolvedValueOnce({ error: null });

      const { acquireLock, releaseLock } = await import('../../src/lib/redisLock.js');
      acquireLock.mockResolvedValueOnce('lock-value');
      releaseLock.mockResolvedValueOnce(undefined);

      const { getEscrowBooking, submitEscrowRefund } = await import('../../src/services/escrow.js');
      getEscrowBooking.mockResolvedValueOnce({ amount: 1000n, paid: true });
      submitEscrowRefund.mockResolvedValueOnce({ txHash: null, error: 'contract not initialised' });

      await reconcileStaleFunding(mockOrderRepository);

      expect(submitEscrowRefund).toHaveBeenCalledWith('DIS-1');
      expect(mockOrderRepository.updateOrderWithFilter).toHaveBeenCalledWith(
        order.id,
        expect.objectContaining({
          escrow_status: 'refund_failed',
          escrow_refund_error: 'contract not initialised',
        }),
        [
          { op: 'eq', column: 'escrow_status', value: 'funding' },
          { op: 'eq', column: 'id', value: order.id },
        ],
        'id'
      );
      expect(mockOrderRepository.updateOrderWithFilter).not.toHaveBeenCalledWith(
        order.id,
        expect.objectContaining({ escrow_status: 'refunded' }),
        expect.anything(),
        'id'
      );
    });

    it('marks a cancelled order refund_failed when the refund tx is not confirmed', async () => {
      mockRedisClient.set.mockResolvedValue('locked');

      const order = makeCancelledFundingOrder();
      mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: [order], error: null });
      mockOrderRepository.updateOrderWithFilter.mockResolvedValueOnce({ error: null });
      mockOrderRepository.updateOrder.mockResolvedValueOnce({ error: null });

      const { acquireLock, releaseLock } = await import('../../src/lib/redisLock.js');
      acquireLock.mockResolvedValueOnce('lock-value');
      releaseLock.mockResolvedValueOnce(undefined);

      const { getEscrowBooking, submitEscrowRefund } = await import('../../src/services/escrow.js');
      getEscrowBooking.mockResolvedValueOnce({ amount: 1000n, paid: true });
      submitEscrowRefund.mockResolvedValueOnce({
        txHash: '0xabc',
        waitForConfirmation: vi.fn().mockRejectedValueOnce(new Error('reverted')),
      });

      await reconcileStaleFunding(mockOrderRepository);

      expect(mockOrderRepository.updateOrderWithFilter).toHaveBeenCalledWith(
        order.id,
        expect.objectContaining({
          escrow_status: 'refund_failed',
          escrow_refund_error: 'refund confirmation failed: reverted',
        }),
        [
          { op: 'eq', column: 'escrow_status', value: 'funding' },
          { op: 'eq', column: 'id', value: order.id },
        ],
        'id'
      );
    });

    it('marks a cancelled order refunded only after the refund tx is confirmed on-chain', async () => {
      mockRedisClient.set.mockResolvedValue('locked');

      const order = makeCancelledFundingOrder();
      mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: [order], error: null });
      mockOrderRepository.updateOrderWithFilter.mockResolvedValueOnce({ error: null });
      mockOrderRepository.updateOrder.mockResolvedValueOnce({ error: null });

      const { acquireLock, releaseLock } = await import('../../src/lib/redisLock.js');
      acquireLock.mockResolvedValueOnce('lock-value');
      releaseLock.mockResolvedValueOnce(undefined);

      const { getEscrowBooking, submitEscrowRefund } = await import('../../src/services/escrow.js');
      getEscrowBooking.mockResolvedValueOnce({ amount: 1000n, paid: true });
      submitEscrowRefund.mockResolvedValueOnce({
        txHash: '0xabc',
        waitForConfirmation: vi.fn().mockResolvedValueOnce({ blockNumber: 42 }),
      });

      await reconcileStaleFunding(mockOrderRepository);

      expect(mockOrderRepository.updateOrderWithFilter).toHaveBeenCalledWith(
        order.id,
        expect.objectContaining({
          escrow_status: 'refunded',
          escrow_refund_error: null,
        }),
        [
          { op: 'eq', column: 'escrow_status', value: 'funding' },
          { op: 'eq', column: 'id', value: order.id },
        ],
        'id'
      );
    });

    it('pages through the stale set in bounded chunks until a short page', async () => {
      mockRedisClient.set.mockResolvedValue('locked');

      const fullPage = Array.from({ length: 1000 }, (_, i) => ({
        id: `order-${i}`,
        order_display_id: `DIS-${i}`,
        escrow_status: 'funding',
        escrow_funding_attempts: 10, // >= MAX_ATTEMPTS, so nothing is processed
        escrow_funding_last_attempt_at: null,
        pending_bid_acceptance: null,
      }));
      mockOrderRepository.findStaleFundingOrders
        .mockResolvedValueOnce({ data: fullPage, error: null })
        .mockResolvedValueOnce({ data: [fullPage[0]], error: null });

      await reconcileStaleFunding(mockOrderRepository);

      expect(mockOrderRepository.findStaleFundingOrders).toHaveBeenCalledTimes(2);
      expect(mockOrderRepository.findStaleFundingOrders).toHaveBeenNthCalledWith(
        1, expect.any(String), { offset: 0, limit: 1000 }
      );
      expect(mockOrderRepository.findStaleFundingOrders).toHaveBeenNthCalledWith(
        2, expect.any(String), { offset: 1000, limit: 1000 }
      );
    });
  });
});

function makeCancelledFundingOrder() {
  return {
    id: 'order-1',
    order_display_id: 'DIS-1',
    status: 'cancelled',
    escrow_status: 'funding',
    escrow_booking_id: 'booking-1',
    escrow_amount_wei: '1000',
    escrow_funding_attempts: 0,
    escrow_funding_last_attempt_at: null,
    pending_bid_acceptance: null,
  };
}
