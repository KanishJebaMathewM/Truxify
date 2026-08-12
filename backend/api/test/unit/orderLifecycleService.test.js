import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/lib/redisLock.js', () => ({
  acquireLock: vi.fn(() => Promise.resolve('lock-1')),
  releaseLock: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/services/notificationService.js', () => ({
  expireDeliveryOtps: vi.fn(() => Promise.resolve()),
  sendPushNotification: vi.fn(() => Promise.resolve()),
  sendDeliveryOtpNotification: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../../src/services/escrow.js', () => ({
  submitEscrowRefund: vi.fn(() => Promise.resolve()),
  recordDepositTx: vi.fn(() => Promise.resolve()),
  submitEscrowCancelWithPenalty: vi.fn(() => Promise.resolve()),
  confirmEscrowRefund: vi.fn(() => Promise.resolve()),
  getEscrowBookingId: vi.fn(),
  resolveExpectedDepositAmount: vi.fn(),
  paisaToMaticWei: vi.fn(),
}));

import { OrderLifecycleService } from '../../src/services/order/orderLifecycleService.js';
import { DomainError } from '../../src/services/order/domainError.js';

describe('OrderLifecycleService.cancelOrder (transactional outbox)', () => {
  let service;
  let orderRepository;
  let orderTimelineService;
  let escrow;

  const baseOrder = {
    id: 'ord-1',
    order_display_id: 'ORD-1',
    customer_id: 'cust-1',
    status: 'truck_assigned',
    escrow_status: null,
    escrow_amount_wei: null,
    total_amount: 100000,
    cancellation_fee: 0,
    escrow_refund_attempts: 0,
    escrow_booking_id: null,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    orderRepository = {
      findOrderByAnyId: vi.fn(),
      findVerifiedDeliveryOtp: vi.fn(),
      executeRpc: vi.fn(),
      updateOrder: vi.fn(),
    };
    orderTimelineService = {
      insertCancelEvent: vi.fn(() => Promise.resolve()),
    };
    service = new OrderLifecycleService({
      orderRepository,
      orderTimelineService,
const mockOrderRepository = {
  findOrdersByCustomer: vi.fn(),
  findOrdersWithCount: vi.fn(),
  findProfilesByIds: vi.fn(),
};

describe('orderLifecycleService', () => {
  let orderLifecycleService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { OrderLifecycleService } = await import('../../src/services/order/orderLifecycleService.js');
    orderLifecycleService = new OrderLifecycleService({
      orderRepository: mockOrderRepository,
      orderTimelineService: {},
      bidAcceptanceService: {},
      deliveryVerificationService: {},
      trackingTokenService: null,
    });
    escrow = await import('../../src/services/escrow.js');
    orderRepository.findOrderByAnyId.mockResolvedValue({ data: { ...baseOrder }, error: null });
    orderRepository.findVerifiedDeliveryOtp.mockResolvedValue({ data: null, error: null });
  });

  it('cancels a non-escrow order through update_order_status_tx and writes ORDER_CANCELLED', async () => {
    orderRepository.executeRpc.mockResolvedValue({ data: [{ ...baseOrder, status: 'cancelled' }], error: null });

    const result = await service.cancelOrder('ord-1', 'cust-1', 'changed my mind');

    expect(orderRepository.executeRpc).toHaveBeenCalledTimes(1);
    const [rpcName, params] = orderRepository.executeRpc.mock.calls[0];
    expect(rpcName).toBe('update_order_status_tx');
    expect(params).toMatchObject({
      p_order_id: 'ord-1',
      p_status: 'cancelled',
      p_not_statuses: ['delivered', 'payment_released', 'cancelled'],
      p_event_type: 'ORDER_CANCELLED',
  });

  describe('getActiveOrders', () => {
    it('returns active orders enriched with driver names', async () => {
      mockOrderRepository.findOrdersByCustomer.mockResolvedValue({
        data: [{ id: 'order-1', driver_id: 'driver-1' }],
        error: null,
      });
      mockOrderRepository.findProfilesByIds.mockResolvedValue({
        data: [{ id: 'driver-1', full_name: 'Ravi Kumar' }],
      });

      const result = await orderLifecycleService.getActiveOrders('cust-1');

      expect(result).toHaveLength(1);
      expect(result[0].driver_name).toBe('Ravi Kumar');
      expect(mockOrderRepository.findOrdersByCustomer).toHaveBeenCalledWith(
        'cust-1', '*', expect.any(Array), 'pickup_date', false,
      );
    });

    it('throws when the query fails', async () => {
      mockOrderRepository.findOrdersByCustomer.mockResolvedValue({ data: null, error: { message: 'DB down' } });
      await expect(orderLifecycleService.getActiveOrders('cust-1')).rejects.toThrow();
    });
    expect(result.status).toBe(200);
    expect(orderTimelineService.insertCancelEvent).toHaveBeenCalledWith('ORD-1');
  });

  it('returns 409 when the status guard rejects the cancellation (already cancelled)', async () => {
    orderRepository.executeRpc.mockResolvedValue({ data: [], error: null });

    await expect(service.cancelOrder('ord-1', 'cust-1', 'changed my mind')).rejects.toMatchObject({ status: 409 });
  });

  it('rejects with 500 when the transition RPC fails', async () => {
    orderRepository.executeRpc.mockResolvedValue({ data: null, error: { message: 'db down' } });

    await expect(service.cancelOrder('ord-1', 'cust-1', 'changed my mind')).rejects.toMatchObject({ status: 500 });
  });

  it('rejects with 403 when the caller does not own the order', async () => {
    await expect(service.cancelOrder('ord-1', 'someone-else', 'nope')).rejects.toMatchObject({ status: 403 });
  });

  it('places an escrow-funded order into refund reconciliation with ORDER_CANCELLED', async () => {
    const funded = { ...baseOrder, escrow_status: 'funded', escrow_amount_wei: '1000000000000000000' };
    orderRepository.findOrderByAnyId.mockResolvedValue({ data: funded, error: null });
    orderRepository.executeRpc.mockResolvedValue({
      data: [{ ...funded, status: 'cancelled', escrow_status: 'refund_pending' }],
      error: null,
  describe('getOrderHistory', () => {
    it('returns paginated history', async () => {
      mockOrderRepository.findOrdersWithCount.mockResolvedValue({
        data: [{ id: 'order-1' }],
        error: null,
        count: 1,
      });

      const result = await orderLifecycleService.getOrderHistory('cust-1', 1, 10);

      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.history).toHaveLength(1);
    });
    escrow.submitEscrowCancelWithPenalty.mockRejectedValue(new Error('chain down'));

    const result = await service.cancelOrder('ord-1', 'cust-1', 'changed my mind');

    expect(result.status).toBe(202);
    expect(result.body.escrow_status).toBe('refund_failed');
    const firstCall = orderRepository.executeRpc.mock.calls[0];
    expect(firstCall[0]).toBe('update_order_status_tx');
    expect(firstCall[1]).toMatchObject({
      p_event_type: 'ORDER_CANCELLED',
      p_escrow_status: 'refund_pending',
    it('throws when the history query fails', async () => {
      mockOrderRepository.findOrdersWithCount.mockResolvedValue({ data: null, error: { message: 'DB down' }, count: 0 });
      await expect(orderLifecycleService.getOrderHistory('cust-1', 1, 10)).rejects.toThrow();
    });
  });
});
