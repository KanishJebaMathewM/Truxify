import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: vi.fn((req, res, next) => next()),
  requireRole: vi.fn(() => (req, res, next) => next()),
  verifyJWT: vi.fn((req, res, next) => next()),
  verifyAuthToken: vi.fn().mockResolvedValue({ id: 'mock-user' }),
}));

vi.mock('../../src/services/escrow.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    submitEscrowRefund: vi.fn(),
    submitEscrowCancelWithPenalty: vi.fn(),
    confirmEscrowRefund: vi.fn(),
  };
});

vi.mock('../../src/lib/lockFallback.js', () => ({
  acquireLockOrFallback: vi.fn(() => Promise.resolve({ ok: true, release: vi.fn() })),
}));

import { cancelOrder as cancelOrderController } from '../../src/controllers/orderController.js';
import { OrderLifecycleService } from '../../src/services/order/orderLifecycleService.js';
import { OrderMilestoneService } from '../../src/services/order/orderMilestoneService.js';
import {
  formatIdempotencyKeyBytes32,
  submitEscrowCancelWithPenalty,
  submitEscrowRefund,
} from '../../src/services/escrow.js';
import { acquireLockOrFallback } from '../../src/lib/lockFallback.js';

describe('Order Cancellation Idempotency & Concurrency Tests (#11242)', () => {
  describe('formatIdempotencyKeyBytes32 helper', () => {
    it('returns null when key is null or undefined', () => {
      const zeroKeyNull = formatIdempotencyKeyBytes32(null);
      const zeroKeyUndef = formatIdempotencyKeyBytes32(undefined);
      expect(zeroKeyNull).toBe(null);
      expect(zeroKeyUndef).toBe(null);
    });

    it('returns keccak256 hash of string idempotency key as bytes32', () => {
      const key = 'test-idempotency-key-123';
      const formatted = formatIdempotencyKeyBytes32(key);
      expect(formatted).toMatch(/^0x[0-9a-f]{64}$/i);
      expect(formatted).not.toBe('0x0000000000000000000000000000000000000000000000000000000000000000');
    });

    it('returns deterministic output for identical inputs', () => {
      const key = 'repeatable-uuid-456';
      expect(formatIdempotencyKeyBytes32(key)).toBe(formatIdempotencyKeyBytes32(key));
    });
  });

  describe('orderController.cancelOrder header propagation', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
      mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      mockNext = vi.fn();
    });

    it('extracts idempotency-key header and forwards it to lifecycle service', async () => {
      mockReq = {
        params: { id: 'order-123' },
        user: { id: 'user-456' },
        body: { reason: 'Customer requested' },
        headers: { 'idempotency-key': 'idem-header-key-789' },
      };

      const cancelSpy = vi.spyOn(OrderLifecycleService.prototype, 'cancelOrder').mockResolvedValue({
        status: 200,
        body: { message: 'Order cancelled successfully.' },
      });

      await cancelOrderController(mockReq, mockRes, mockNext);

      expect(cancelSpy).toHaveBeenCalledWith(
        'order-123',
        'user-456',
        'Customer requested',
        undefined,
        'idem-header-key-789'
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      cancelSpy.mockRestore();
    });

    it('extracts x-idempotency-key header as alternative and forwards it', async () => {
      mockReq = {
        params: { id: 'order-123' },
        user: { id: 'user-456' },
        body: { reason: 'Changed my mind' },
        headers: { 'x-idempotency-key': 'x-idem-key-abc' },
      };

      const cancelSpy = vi.spyOn(OrderLifecycleService.prototype, 'cancelOrder').mockResolvedValue({
        status: 200,
        body: { message: 'Order cancelled successfully.' },
      });

      await cancelOrderController(mockReq, mockRes, mockNext);

      expect(cancelSpy).toHaveBeenCalledWith(
        'order-123',
        'user-456',
        'Changed my mind',
        undefined,
        'x-idem-key-abc'
      );
      cancelSpy.mockRestore();
    });
  });

  describe('OrderLifecycleService idempotency & concurrency', () => {
    let orderRepository;
    let orderTimelineService;
    let service;
    const baseOrder = {
      id: 'ord-1',
      order_display_id: 'ORD-1',
      customer_id: 'cust-1',
      driver_id: 'drv-1',
      status: 'pending',
      escrow_status: null,
      total_amount: '1000',
      cancellation_fee: 0,
    };

    beforeEach(() => {
      vi.clearAllMocks();
      orderRepository = {
        findOrderByAnyId: vi.fn(),
        findVerifiedDeliveryOtp: vi.fn().mockResolvedValue({ data: null, error: null }),
        executeRpc: vi.fn(),
        updateOrder: vi.fn().mockResolvedValue({ data: {}, error: null }),
      };
      orderTimelineService = {
        insertCancelEvent: vi.fn().mockResolvedValue(),
      };
      service = new OrderLifecycleService({
        orderRepository,
        orderTimelineService,
      });
    });

    it('returns cached response when order was already cancelled with matching idempotency key', async () => {
      const cancelledOrder = {
        ...baseOrder,
        status: 'cancelled',
        cancellation_idempotency_key: 'idemp-key-dup',
      };
      orderRepository.findOrderByAnyId.mockResolvedValue({ data: cancelledOrder, error: null });

      const result = await service.cancelOrder('ord-1', 'cust-1', 'second tap', undefined, 'idemp-key-dup');

      expect(result.status).toBe(200);
      expect(result.body.message).toBe('Order was already cancelled.');
      // Crucial: executeRpc is NOT invoked again on duplicate cancellation request
      expect(orderRepository.executeRpc).not.toHaveBeenCalled();
    });

    it('forwards idempotencyKey to submitEscrowCancelWithPenalty on escrow orders', async () => {
      const assignedOrder = {
        ...baseOrder,
        status: 'truck_assigned',
        escrow_status: 'funded',
        escrow_amount_wei: '1000000000000000000',
      };
      orderRepository.findOrderByAnyId.mockResolvedValue({ data: assignedOrder, error: null });
      orderRepository.executeRpc
        .mockResolvedValueOnce({ data: [{ ...assignedOrder, status: 'cancelled', escrow_status: 'refund_pending' }], error: null })
        .mockResolvedValueOnce({ data: [{ ...assignedOrder, status: 'cancelled', escrow_status: 'refunded' }], error: null });

      vi.mocked(submitEscrowCancelWithPenalty).mockResolvedValueOnce({
        txHash: '0xrefundtxhash',
        waitForConfirmation: vi.fn().mockResolvedValue({ hash: '0xrefundtxhash' }),
      });

      const result = await service.cancelOrder('ord-1', 'cust-1', 'driver too slow', undefined, 'idemp-escrow-key');

      expect(result.status).toBe(200);
      expect(submitEscrowCancelWithPenalty).toHaveBeenCalledWith(
        'ORD-1',
        100000000000000000n, // 10% penalty
        'idemp-escrow-key'
      );
      expect(orderRepository.updateOrder).toHaveBeenCalledWith(
        'ord-1',
        expect.objectContaining({
          cancellation_idempotency_key: 'idemp-escrow-key',
        })
      );
    });

    it('retries refund reconciliation when order is cancelled but escrow_status is refund_failed', async () => {
      const failedRefundOrder = {
        ...baseOrder,
        status: 'cancelled',
        escrow_status: 'refund_failed',
        escrow_amount_wei: '1000000000000000000',
        cancellation_idempotency_key: 'retry-idem-key',
      };
      orderRepository.findOrderByAnyId.mockResolvedValue({ data: failedRefundOrder, error: null });
      orderRepository.executeRpc
        .mockResolvedValueOnce({ data: [{ ...failedRefundOrder, escrow_status: 'refund_pending' }], error: null })
        .mockResolvedValueOnce({ data: [{ ...failedRefundOrder, escrow_status: 'refunded' }], error: null });

      vi.mocked(submitEscrowRefund).mockResolvedValueOnce({
        txHash: '0xretryrefundtx',
        waitForConfirmation: vi.fn().mockResolvedValue({ hash: '0xretryrefundtx' }),
      });

      const result = await service.cancelOrder('ord-1', 'cust-1', 'retry cancel', undefined, 'retry-idem-key');

      expect(result.status).toBe(200);
      expect(submitEscrowRefund).toHaveBeenCalledWith('ORD-1', 'retry-idem-key');
    });

    it('rejects cancellation when order is already picked_up / in transit', async () => {
      const inTransitOrder = {
        ...baseOrder,
        status: 'picked_up',
      };
      orderRepository.findOrderByAnyId.mockResolvedValue({ data: inTransitOrder, error: null });

      await expect(
        service.cancelOrder('ord-1', 'cust-1', 'too late', undefined, 'idemp-late-key')
      ).rejects.toMatchObject({
        status: 409,
        payload: { error: 'Cannot cancel: the shipment has already been picked up and is in transit.' },
      });
    });

    it('fails with 409 when cancellation lock cannot be acquired due to active contention', async () => {
      orderRepository.findOrderByAnyId.mockResolvedValue({ data: baseOrder, error: null });
      vi.mocked(acquireLockOrFallback).mockResolvedValueOnce({
        ok: false,
        release: vi.fn(),
      });

      await expect(
        service.cancelOrder('ord-1', 'cust-1', 'concurrent attempt', undefined, 'idemp-contention')
      ).rejects.toMatchObject({
        status: 409,
        payload: { error: 'Cancellation is currently being processed. Please try again later.' },
      });
    });
  });

  describe('OrderMilestoneService serialization against cancellation', () => {
    let orderRepository;
    let milestoneService;
    const activeOrder = {
      id: 'ord-m1',
      order_display_id: 'ORD-M1',
      driver_id: 'drv-m1',
      status: 'arrived_pickup',
    };

    beforeEach(() => {
      vi.clearAllMocks();
      orderRepository = {
        findOrderById: vi.fn(),
        executeRpc: vi.fn(),
        updateOrder: vi.fn(),
        addMilestone: vi.fn(),
        completeMilestone: vi.fn(),
      };
      milestoneService = new OrderMilestoneService({
        orderRepository,
      });
    });

    it('rejects milestone update when order is cancelled', async () => {
      orderRepository.findOrderById.mockResolvedValue({
        data: { ...activeOrder, status: 'cancelled' },
        error: null,
      });

      await expect(
        milestoneService.updateMilestone({
          orderId: 'ord-m1',
          milestone: 'Goods Loaded',
          driverId: 'drv-m1',
        })
      ).rejects.toMatchObject({
        status: 409,
        payload: { error: 'Cannot update milestone: order has been cancelled.' },
      });
    });

    it('rejects milestone update if order commits cancellation between initial check and lock acquisition', async () => {
      // First call (before lock): status is active
      // Second call (after lock): status became cancelled
      orderRepository.findOrderById
        .mockResolvedValueOnce({ data: activeOrder, error: null })
        .mockResolvedValueOnce({ data: { ...activeOrder, status: 'cancelled' }, error: null });

      await expect(
        milestoneService.updateMilestone({
          orderId: 'ord-m1',
          milestone: 'Goods Loaded',
          driverId: 'drv-m1',
        })
      ).rejects.toMatchObject({
        status: 409,
        payload: { error: 'Cannot update milestone: order has been cancelled.' },
      });
    });

    it('rejects milestone update when cancel lock cannot be acquired (active cancel in progress)', async () => {
      orderRepository.findOrderById.mockResolvedValue({
        data: activeOrder,
        error: null,
      });

      vi.mocked(acquireLockOrFallback).mockResolvedValueOnce({
        ok: false,
        release: vi.fn(),
      });

      await expect(
        milestoneService.updateMilestone({
          orderId: 'ord-m1',
          milestone: 'Goods Loaded',
          driverId: 'drv-m1',
        })
      ).rejects.toMatchObject({
        status: 409,
        payload: { error: 'Order is currently being cancelled or modified. Cannot update milestone.' },
      });
    });
  });
});
