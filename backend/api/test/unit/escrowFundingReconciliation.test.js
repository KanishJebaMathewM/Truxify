/**
 * Unit tests for backend/api/src/services/escrowFundingReconciliation.js
 *
 * Coverage:
 *   - processes pending orders and calls escrow/blockchain operations
 *   - handles DB fetch errors gracefully
 *   - handles lock acquisition failures (global and per-order)
 *   - handles blockchain transaction failures with retry scheduling
 *   - marks orders as permanently failed / escalated after max retries
 *   - skips when no pending orders exist
 *   - startEscrowFundingReconciliation and stopEscrowFundingReconciliation lifecycle
 *
 * Run with:  npx vitest run backend/api/test/unit/escrowFundingReconciliation.test.js
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
  supabaseAdmin: { auth: {} },
}));

vi.mock('../../src/services/escrow.js', () => ({
  submitEscrowRefund: vi.fn(),
  submitEscrowCancelWithPenalty: vi.fn(),
  paisaToMaticWei: vi.fn(),
  getEscrowBooking: vi.fn(),
  weiWithinTolerance: vi.fn((a, b) => {
    if (a == null || b == null) return false;
    return BigInt(a) === BigInt(b);
  }),
}));

vi.mock('../../src/lib/redisLock.js', () => ({
  acquireLock: vi.fn(),
  renewLock: vi.fn(),
  releaseLock: vi.fn(),
  withLockRenewal: vi.fn(async (key, val, ttl, fn) => {
    return await fn();
  }),
}));

vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

// Mock the order repository
const mockOrderRepository = vi.hoisted(() => ({
  findStaleFundingOrders: vi.fn(),
  updateOrder: vi.fn(),
  updateOrderWithFilter: vi.fn(),
  executeRpc: vi.fn(),
}));

import {
  reconcileStaleFunding,
  processQueue,
  startEscrowFundingReconciliation,
  stopEscrowFundingReconciliation,
} from '../../src/services/escrowFundingReconciliation.js';
import { acquireLock, renewLock, releaseLock, withLockRenewal } from '../../src/lib/redisLock.js';
import { getEscrowBooking, submitEscrowRefund, weiWithinTolerance } from '../../src/services/escrow.js';
import { sendPushNotification } from '../../src/services/notificationService.js';

describe('escrowFundingReconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acquireLock.mockResolvedValue('mock-lock-token');
    releaseLock.mockResolvedValue(true);
    renewLock.mockResolvedValue(true);
    withLockRenewal.mockImplementation(async (key, val, ttl, fn) => await fn());
    mockOrderRepository.updateOrder.mockResolvedValue({ error: null });
    mockOrderRepository.updateOrderWithFilter.mockResolvedValue({ error: null });
    mockOrderRepository.executeRpc.mockResolvedValue({ error: null });
  });

  describe('processQueue / reconcileStaleFunding', () => {
    it('exports processQueue as an alias to reconcileStaleFunding', () => {
      expect(processQueue).toBe(reconcileStaleFunding);
    });

    it('throws when orderRepository is null', async () => {
      await expect(processQueue(null)).rejects.toThrow('requires an OrderRepository instance');
    });

    describe('skips when no pending orders exist', () => {
      it('skips processing when stale orders list is empty', async () => {
        mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: [], error: null });

        await processQueue(mockOrderRepository);

        expect(mockOrderRepository.findStaleFundingOrders).toHaveBeenCalledTimes(1);
        expect(getEscrowBooking).not.toHaveBeenCalled();
        expect(submitEscrowRefund).not.toHaveBeenCalled();
        expect(mockOrderRepository.updateOrderWithFilter).not.toHaveBeenCalled();
      });

      it('skips processing when stale orders is null/undefined', async () => {
        mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: null, error: null });

        await processQueue(mockOrderRepository);

        expect(mockOrderRepository.findStaleFundingOrders).toHaveBeenCalledTimes(1);
        expect(getEscrowBooking).not.toHaveBeenCalled();
      });
    });

    describe('handles DB fetch errors gracefully', () => {
      it('logs error and returns early on DB error when fetching stale orders', async () => {
        mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({
          data: null,
          error: { message: 'Database connection failed' },
        });

        await processQueue(mockOrderRepository);

        expect(mockLogger.error).toHaveBeenCalledWith(
          '[escrow-funding] Failed to load stale funding orders:',
          'Database connection failed'
        );
        expect(getEscrowBooking).not.toHaveBeenCalled();
      });

      it('handles string error responses from orderRepository gracefully', async () => {
        mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({
          data: null,
          error: 'Raw DB error string',
        });

        await processQueue(mockOrderRepository);

        expect(mockLogger.error).toHaveBeenCalledWith(
          '[escrow-funding] Failed to load stale funding orders:',
          'Raw DB error string'
        );
      });
    });

    describe('handles lock acquisition failures', () => {
      it('skips batch when global Redis lock is not acquired', async () => {
        acquireLock.mockResolvedValueOnce(null); // global lock returns null

        await processQueue(mockOrderRepository);

        expect(mockLogger.info).toHaveBeenCalledWith(
          '[escrow-funding] Global lock held by another instance, skipping batch.'
        );
        expect(mockOrderRepository.findStaleFundingOrders).not.toHaveBeenCalled();
      });

      it('handles global lock exception and returns early', async () => {
        acquireLock.mockRejectedValueOnce(new Error('Redis connection timeout'));

        await processQueue(mockOrderRepository);

        expect(mockLogger.error).toHaveBeenCalledWith(
          '[escrow-funding] Failed to acquire Redis global lock, skipping batch:',
          'Redis connection timeout'
        );
        expect(mockOrderRepository.findStaleFundingOrders).not.toHaveBeenCalled();
      });

      it('skips individual order when per-order lock is already held', async () => {
        // Global lock succeeds, but per-order lock fails
        acquireLock
          .mockResolvedValueOnce('global-lock-token')
          .mockResolvedValueOnce(null); // per-order lock returns null

        const order = {
          id: 'order-locked-1',
          order_display_id: 'DIS-LOCKED-1',
          escrow_status: 'funding',
          escrow_booking_id: 'booking-locked-1',
          escrow_funding_attempts: 0,
          escrow_funding_last_attempt_at: null,
          pending_bid_acceptance: null,
        };
        mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: [order], error: null });

        await processQueue(mockOrderRepository);

        expect(mockLogger.info).toHaveBeenCalledWith(
          '[escrow-funding] Order DIS-LOCKED-1 locked by another process, skipping.'
        );
        expect(getEscrowBooking).not.toHaveBeenCalled();
      });
    });

    describe('processes pending orders and calls blockchain escrow operations', () => {
      it('heals a funded deposit to escrow_status "funded" and runs accept_bid_tx', async () => {
        const healedOrder = {
          id: 'order-heal-1',
          order_display_id: 'DIS-HEAL-1',
          escrow_status: 'funding',
          escrow_booking_id: 'booking-heal-1',
          escrow_amount_wei: '1000000000000000000',
          escrow_funding_attempts: 0,
          escrow_funding_last_attempt_at: null,
          customer_id: 'cust-1',
          pending_bid_acceptance: {
            bid_id: 'bid-123',
            load_id: 'load-456',
            driver_id: 'driver-789',
            truck_id: 'truck-101',
            driver_name: 'John Driver',
            driver_rating: 4.9,
            truck_number: 'TRK-99',
            bid_amount: 500,
            order_display_id: 'DIS-HEAL-1',
            version: 2,
          },
        };

        mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: [healedOrder], error: null });
        getEscrowBooking.mockResolvedValueOnce({ amount: 1000000000000000000n });
        mockOrderRepository.executeRpc.mockResolvedValueOnce({ error: null });

        await processQueue(mockOrderRepository);

        expect(getEscrowBooking).toHaveBeenCalledWith('booking-heal-1');
        expect(mockOrderRepository.executeRpc).toHaveBeenCalledWith(
          'accept_bid_tx',
          expect.objectContaining({
            p_bid_id: 'bid-123',
            p_order_id: 'order-heal-1',
            p_load_id: 'load-456',
            p_driver_id: 'driver-789',
            p_escrow_booking_id: 'booking-heal-1',
          }),
          expect.any(Object)
        );
        expect(sendPushNotification).toHaveBeenCalledWith(
          'driver-789',
          'Bid Accepted!',
          expect.stringContaining('DIS-HEAL-1'),
          'order_update',
          expect.objectContaining({ orderId: 'order-heal-1' })
        );
        expect(mockOrderRepository.updateOrderWithFilter).toHaveBeenCalledWith(
          'order-heal-1',
          expect.objectContaining({
            escrow_status: 'funded',
            escrow_funding_attempts: 0,
            escrow_funding_error: null,
            escrow_funding_last_attempt_at: null,
          }),
          [{ op: 'eq', column: 'escrow_status', value: 'funding' }],
          'id'
        );
      });

      it('reverts order to pending and triggers escrow refund when deposit never landed on chain', async () => {
        const unconfirmedOrder = {
          id: 'order-revert-1',
          order_display_id: 'DIS-REVERT-1',
          escrow_status: 'funding',
          escrow_booking_id: 'booking-unconfirmed',
          escrow_amount_wei: '2000000000000000000',
          escrow_funding_attempts: 0,
          escrow_funding_last_attempt_at: null,
          customer_id: 'cust-revert-1',
          pending_bid_acceptance: { bid_id: 'bid-revert' },
        };

        mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: [unconfirmedOrder], error: null });
        getEscrowBooking.mockResolvedValueOnce(null); // deposit never landed
        const waitForConfirmation = vi.fn().mockResolvedValueOnce(undefined);
        submitEscrowRefund.mockResolvedValueOnce({ txHash: '0xrefundtx123', waitForConfirmation });

        await processQueue(mockOrderRepository);

        expect(submitEscrowRefund).toHaveBeenCalledWith('DIS-REVERT-1');
        expect(waitForConfirmation).toHaveBeenCalled();
        expect(mockOrderRepository.updateOrderWithFilter).toHaveBeenCalledWith(
          'order-revert-1',
          expect.objectContaining({
            escrow_status: 'pending',
            escrow_booking_id: null,
            pending_bid_acceptance: null,
            escrow_funding_attempts: 0,
            escrow_funding_last_attempt_at: null,
            escrow_funding_error: null,
          }),
          [
            { op: 'eq', column: 'escrow_status', value: 'funding' },
            { op: 'eq', column: 'id', value: 'order-revert-1' },
          ],
          'id'
        );
        expect(sendPushNotification).toHaveBeenCalledWith(
          'cust-revert-1',
          'Bid Acceptance Expired',
          expect.stringContaining('not completed in time'),
          'order_update',
          expect.objectContaining({ orderId: 'order-revert-1' })
        );
      });

      it('reverts and records mismatch when booking amount differs from expected amount', async () => {
        const mismatchedOrder = {
          id: 'order-mismatch-1',
          order_display_id: 'DIS-MISMATCH-1',
          escrow_status: 'funding',
          escrow_booking_id: 'booking-mismatch-1',
          escrow_amount_wei: '5000000000000000000',
          escrow_funding_attempts: 0,
          escrow_funding_last_attempt_at: null,
          customer_id: 'cust-mismatch-1',
          pending_bid_acceptance: null,
        };

        mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: [mismatchedOrder], error: null });
        // Actual on-chain amount is 1 wei instead of 5 ETH
        getEscrowBooking.mockResolvedValueOnce({ amount: 1000000000000000000n });
        const waitForConfirmation = vi.fn().mockResolvedValueOnce(undefined);
        submitEscrowRefund.mockResolvedValueOnce({ txHash: '0xmismatchtx', waitForConfirmation });

        await processQueue(mockOrderRepository);

        expect(submitEscrowRefund).toHaveBeenCalledWith('DIS-MISMATCH-1');
        expect(mockOrderRepository.updateOrderWithFilter).toHaveBeenCalledWith(
          'order-mismatch-1',
          expect.objectContaining({
            escrow_status: 'pending',
            escrow_funding_error: expect.stringContaining('ESCROW_AMOUNT_MISMATCH'),
          }),
          [
            { op: 'eq', column: 'escrow_status', value: 'funding' },
            { op: 'eq', column: 'id', value: 'order-mismatch-1' },
          ],
          'id'
        );
      });

      it('refunds cancelled order when deposit landed on chain', async () => {
        const cancelledOrder = {
          id: 'order-cancel-1',
          order_display_id: 'DIS-CANCEL-1',
          status: 'cancelled',
          escrow_status: 'funding',
          escrow_booking_id: 'booking-cancel-1',
          escrow_amount_wei: '1000000000000000000',
          escrow_funding_attempts: 0,
          escrow_funding_last_attempt_at: null,
          customer_id: 'cust-1',
          pending_bid_acceptance: null,
        };

        mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: [cancelledOrder], error: null });
        getEscrowBooking.mockResolvedValueOnce({ amount: 1000000000000000000n });
        const waitForConfirmation = vi.fn().mockResolvedValueOnce(undefined);
        submitEscrowRefund.mockResolvedValueOnce({ txHash: '0xcanceltx', waitForConfirmation });

        await processQueue(mockOrderRepository);

        expect(submitEscrowRefund).toHaveBeenCalledWith('DIS-CANCEL-1');
        expect(waitForConfirmation).toHaveBeenCalled();
        expect(mockOrderRepository.updateOrderWithFilter).toHaveBeenCalledWith(
          'order-cancel-1',
          expect.objectContaining({ escrow_status: 'refunded', escrow_refund_error: null }),
          [
            { op: 'eq', column: 'escrow_status', value: 'funding' },
            { op: 'eq', column: 'id', value: 'order-cancel-1' },
          ],
          'id'
        );
      });
    });

    describe('handles blockchain transaction failures with retry scheduling', () => {
      it('schedules retry when blockchain booking lookup or processing throws an exception', async () => {
        const failingOrder = {
          id: 'order-fail-rpc',
          order_display_id: 'DIS-FAIL-RPC',
          escrow_status: 'funding',
          escrow_booking_id: 'booking-err',
          escrow_funding_attempts: 2,
          escrow_funding_last_attempt_at: null,
          pending_bid_acceptance: null,
        };

        mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: [failingOrder], error: null });
        getEscrowBooking.mockRejectedValueOnce(new Error('RPC provider network error'));

        await processQueue(mockOrderRepository);

        expect(mockOrderRepository.updateOrder).toHaveBeenCalledWith(
          'order-fail-rpc',
          expect.objectContaining({
            escrow_funding_attempts: 3,
            escrow_funding_error: 'RPC provider network error',
            escrow_funding_last_attempt_at: expect.any(String),
          })
        );
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Order DIS-FAIL-RPC funding reconciliation retry 3/10: RPC provider network error')
        );
      });

      it('skips orders that are currently in exponential backoff period', async () => {
        const recentAttemptOrder = {
          id: 'order-backoff',
          order_display_id: 'DIS-BACKOFF',
          escrow_status: 'funding',
          escrow_booking_id: 'booking-backoff',
          escrow_funding_attempts: 1, // backoff is 2^0 * 60000ms = 60s
          escrow_funding_last_attempt_at: new Date(Date.now() - 10000).toISOString(), // 10s ago, so < 60s
          pending_bid_acceptance: null,
        };

        mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: [recentAttemptOrder], error: null });

        await processQueue(mockOrderRepository);

        // Order is not due for retry yet, so finalizeOrRevert should not run
        expect(getEscrowBooking).not.toHaveBeenCalled();
      });

      it('processes orders whose backoff window has expired', async () => {
        const expiredBackoffOrder = {
          id: 'order-backoff-expired',
          order_display_id: 'DIS-BACKOFF-EXPIRED',
          escrow_status: 'funding',
          escrow_booking_id: 'booking-expired',
          escrow_amount_wei: '1000000000000000000',
          escrow_funding_attempts: 1,
          escrow_funding_last_attempt_at: new Date(Date.now() - 120000).toISOString(), // 120s ago > 60s backoff
          pending_bid_acceptance: null,
        };

        mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: [expiredBackoffOrder], error: null });
        getEscrowBooking.mockResolvedValueOnce(null);
        submitEscrowRefund.mockResolvedValueOnce({
          txHash: '0xrefund',
          waitForConfirmation: vi.fn().mockResolvedValueOnce(undefined),
        });

        await processQueue(mockOrderRepository);

        expect(getEscrowBooking).toHaveBeenCalledWith('booking-expired');
      });

      it('records refund_failed when submitEscrowRefund returns an error for cancelled order', async () => {
        const cancelledOrder = {
          id: 'order-cancel-fail',
          order_display_id: 'DIS-CANCEL-FAIL',
          status: 'cancelled',
          escrow_status: 'funding',
          escrow_booking_id: 'booking-fail',
          escrow_amount_wei: '1000000000000000000',
          escrow_funding_attempts: 0,
          escrow_funding_last_attempt_at: null,
          customer_id: 'cust-1',
        };

        mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: [cancelledOrder], error: null });
        getEscrowBooking.mockResolvedValueOnce({ amount: 1000000000000000000n });
        submitEscrowRefund.mockResolvedValueOnce({ txHash: null, error: 'out of gas' });

        await processQueue(mockOrderRepository);

        expect(mockOrderRepository.updateOrderWithFilter).toHaveBeenCalledWith(
          'order-cancel-fail',
          expect.objectContaining({
            escrow_status: 'refund_failed',
            escrow_refund_error: 'out of gas',
          }),
          [
            { op: 'eq', column: 'escrow_status', value: 'funding' },
            { op: 'eq', column: 'id', value: 'order-cancel-fail' },
          ],
          'id'
        );
      });
    });

    describe('marks orders as permanently failed / escalated after max retries', () => {
      it('skips orders that have already reached or exceeded MAX_ATTEMPTS (10)', async () => {
        const maxRetriedOrder = {
          id: 'order-max-reached',
          order_display_id: 'DIS-MAX-REACHED',
          escrow_status: 'funding',
          escrow_booking_id: 'booking-max',
          escrow_funding_attempts: 10,
          escrow_funding_last_attempt_at: null,
          pending_bid_acceptance: null,
        };

        mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: [maxRetriedOrder], error: null });

        await processQueue(mockOrderRepository);

        expect(getEscrowBooking).not.toHaveBeenCalled();
        expect(submitEscrowRefund).not.toHaveBeenCalled();
      });

      it('logs manual review escalation when order reaches MAX_ATTEMPTS on failure', async () => {
        const ninthAttemptOrder = {
          id: 'order-attempt-9',
          order_display_id: 'DIS-ATTEMPT-9',
          escrow_status: 'funding',
          escrow_booking_id: 'booking-9',
          escrow_funding_attempts: 9,
          escrow_funding_last_attempt_at: null,
          pending_bid_acceptance: null,
        };

        mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: [ninthAttemptOrder], error: null });
        getEscrowBooking.mockRejectedValueOnce(new Error('Persistent contract revert'));

        await processQueue(mockOrderRepository);

        expect(mockOrderRepository.updateOrder).toHaveBeenCalledWith(
          'order-attempt-9',
          expect.objectContaining({
            escrow_funding_attempts: 10,
            escrow_funding_error: 'Persistent contract revert',
          })
        );
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('reached max funding reconciliation retries (10) and is escalated to manual review')
        );
      });
    });

    describe('pagination through stale funding orders', () => {
      it('pages through stale orders set in bounded chunks until short page', async () => {
        const fullPage = Array.from({ length: 1000 }, (_, i) => ({
          id: `order-page-${i}`,
          order_display_id: `DIS-PAGE-${i}`,
          escrow_status: 'funding',
          escrow_funding_attempts: 10, // will be skipped so test runs quickly
          escrow_funding_last_attempt_at: null,
          pending_bid_acceptance: null,
        }));

        mockOrderRepository.findStaleFundingOrders
          .mockResolvedValueOnce({ data: fullPage, error: null })
          .mockResolvedValueOnce({ data: [fullPage[0]], error: null });

        await processQueue(mockOrderRepository);

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

  describe('startEscrowFundingReconciliation & stopEscrowFundingReconciliation', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      stopEscrowFundingReconciliation();
    });

    it('starts reconciliation worker timer with configured or default interval and stops it cleanly', () => {
      startEscrowFundingReconciliation(mockOrderRepository);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('[escrow-funding] Funding reconciliation worker started')
      );

      // Starting a second time is a no-op
      startEscrowFundingReconciliation(mockOrderRepository);

      // Stopping clears the timer
      stopEscrowFundingReconciliation();
      // Stopping again is a safe no-op
      stopEscrowFundingReconciliation();
    });

    it('triggers reconcileStaleFunding on interval tick', async () => {
      mockOrderRepository.findStaleFundingOrders.mockResolvedValue({ data: [], error: null });

      startEscrowFundingReconciliation(mockOrderRepository);

      await vi.advanceTimersByTimeAsync(60000);

      expect(mockOrderRepository.findStaleFundingOrders).toHaveBeenCalled();
      stopEscrowFundingReconciliation();
    });
  });
});
