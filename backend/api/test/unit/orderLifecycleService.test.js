import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/lib/redisLock.js', () => ({
  acquireLock: vi.fn(() => Promise.resolve('lock-1')),
  releaseLock: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/lib/lockFallback.js', () => ({
  acquireLockOrFallback: vi.fn(() => Promise.resolve({ ok: true, release: vi.fn() })),
}));

vi.mock('../../src/services/notificationService.js', () => ({
  expireDeliveryOtps: vi.fn(() => Promise.resolve()),
  sendPushNotification: vi.fn(() => Promise.resolve()),
  sendDeliveryOtpNotification: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../../src/services/escrow.js', () => ({
  submitEscrowRefund: vi.fn(),
  recordDepositTx: vi.fn(() => Promise.resolve()),
  submitEscrowCancelWithPenalty: vi.fn(),
  confirmEscrowRefund: vi.fn(),
  getEscrowBookingId: vi.fn(),
  resolveExpectedDepositAmount: vi.fn(),
  paisaToMaticWei: vi.fn(),
}));

vi.mock('../../src/services/order/deliveryVerificationService.js', () => ({
  DeliveryVerificationService: class {},
}));

vi.mock('../../src/core/events/index.js', () => ({
  eventBus: { emitSafe: vi.fn() },
}));

vi.mock('../../src/config/db.js', () => {
  const chain = () => ({
    select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
  });
  return {
    supabase: { from: () => chain() },
    supabaseAdmin: { from: () => chain() },
    mongoDb: null,
    redisClient: {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve('OK'),
      del: () => Promise.resolve(1),
      call: () => Promise.resolve(1),
      status: 'ready',
    },
    upstashRedisClient: null,
    firebaseAdmin: null,
  };
});

import { OrderLifecycleService } from '../../src/services/order/orderLifecycleService.js';
import { submitEscrowCancelWithPenalty } from '../../src/services/escrow.js';

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

function createService(orderRepository, orderTimelineService) {
  return new OrderLifecycleService({
    orderRepository,
    orderTimelineService,
    bidAcceptanceService: {},
    deliveryVerificationService: {},
    trackingTokenService: null,
  });
}

describe('OrderLifecycleService.cancelOrder (transactional outbox)', () => {
  let orderRepository;
  let orderTimelineService;
  let service;

  beforeEach(() => {
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
    service = createService(orderRepository, orderTimelineService);
    orderRepository.findOrderByAnyId.mockResolvedValue({ data: { ...baseOrder }, error: null });
    orderRepository.findVerifiedDeliveryOtp.mockResolvedValue({ data: null, error: null });
  });

  it('cancels a non-escrow order through update_order_status_tx and writes ORDER_CANCELLED', async () => {
    orderRepository.executeRpc.mockResolvedValue({ data: [{ ...baseOrder, status: 'cancelled' }], error: null });

    const result = await service.cancelOrder('ord-1', 'cust-1', 'changed my mind');

    expect(result.status).toBe(200);
    expect(result.body.message).toBe('Order cancelled successfully.');
    expect(orderRepository.executeRpc).toHaveBeenCalledTimes(1);
    const [rpcName, params] = orderRepository.executeRpc.mock.calls[0];
    expect(rpcName).toBe('update_order_status_tx');
    expect(params).toMatchObject({
      p_order_id: 'ord-1',
      p_status: 'cancelled',
      p_not_statuses: ['delivered', 'payment_released', 'cancelled'],
      p_event_type: 'ORDER_CANCELLED',
    });
    expect(orderTimelineService.insertCancelEvent).toHaveBeenCalledWith('ORD-1');
  });

  it('throws 404 when the order is not found', async () => {
    orderRepository.findOrderByAnyId.mockResolvedValue({ data: null, error: null });

    await expect(service.cancelOrder('ord-1', 'cust-1', 'why')).rejects.toMatchObject({ status: 404 });
  });

  it('throws 403 when the caller does not own the order', async () => {
    await expect(service.cancelOrder('ord-1', 'someone-else', 'nope')).rejects.toMatchObject({ status: 403 });
  });

  it('throws 409 when a verified delivery OTP blocks the cancellation', async () => {
    orderRepository.findVerifiedDeliveryOtp.mockResolvedValue({ data: { id: 'otp-1' }, error: null });

    await expect(service.cancelOrder('ord-1', 'cust-1', 'why')).rejects.toMatchObject({ status: 409 });
  });

  it('throws 409 when the status guard rejects the cancellation', async () => {
    orderRepository.executeRpc.mockResolvedValue({ data: [], error: null });

    await expect(service.cancelOrder('ord-1', 'cust-1', 'why')).rejects.toMatchObject({ status: 409 });
  });

  it('throws 500 when the transition RPC fails', async () => {
    orderRepository.executeRpc.mockResolvedValue({ data: null, error: { message: 'db down' } });

    await expect(service.cancelOrder('ord-1', 'cust-1', 'why')).rejects.toMatchObject({ status: 500 });
  });

  it('refunds an escrow-funded order and returns the refunded body', async () => {
    const funded = { ...baseOrder, escrow_status: 'funded', escrow_amount_wei: '1000000000000000000' };
    orderRepository.findOrderByAnyId.mockResolvedValue({ data: funded, error: null });
    orderRepository.executeRpc
      .mockResolvedValueOnce({ data: [{ ...funded, status: 'cancelled', escrow_status: 'refund_pending' }], error: null })
      .mockResolvedValueOnce({ data: [{ ...funded, status: 'cancelled', escrow_status: 'refunded' }], error: null });
    submitEscrowCancelWithPenalty.mockResolvedValue({
      txHash: '0xabc',
      waitForConfirmation: () => Promise.resolve({ hash: '0xabc' }),
    });
    orderRepository.updateOrder.mockResolvedValue({ error: null });

    const result = await service.cancelOrder('ord-1', 'cust-1', 'changed my mind');

    expect(result.status).toBe(200);
    expect(result.body.message).toBe('Order cancelled and escrow refunded successfully.');
    expect(result.body.order.escrow_status).toBe('refunded');
    expect(submitEscrowCancelWithPenalty).toHaveBeenCalled();
    expect(orderTimelineService.insertCancelEvent).toHaveBeenCalledWith('ORD-1');
  });

  it('returns 202 refund_failed when the on-chain refund chain fails', async () => {
    const funded = { ...baseOrder, escrow_status: 'funded', escrow_amount_wei: '1000000000000000000' };
    orderRepository.findOrderByAnyId.mockResolvedValue({ data: funded, error: null });
    orderRepository.executeRpc
      .mockResolvedValueOnce({ data: [{ ...funded, status: 'cancelled', escrow_status: 'refund_pending' }], error: null })
      .mockResolvedValue({ data: null, error: null });
    orderRepository.updateOrder.mockResolvedValue({ error: null });
    submitEscrowCancelWithPenalty.mockRejectedValue(new Error('chain down'));

    const result = await service.cancelOrder('ord-1', 'cust-1', 'changed my mind');

    expect(result.status).toBe(202);
    expect(result.body.escrow_status).toBe('refund_failed');
    expect(result.body.retryable).toBe(true);
  });

  it('throws 500 when placing the order into refund reconciliation fails', async () => {
    const funded = { ...baseOrder, escrow_status: 'funded', escrow_amount_wei: '1000000000000000000' };
    orderRepository.findOrderByAnyId.mockResolvedValue({ data: funded, error: null });
    orderRepository.executeRpc.mockResolvedValue({ data: null, error: { message: 'db down' } });

    await expect(service.cancelOrder('ord-1', 'cust-1', 'why')).rejects.toMatchObject({ status: 500 });
  });
  it('rejects null or undefined orderId when updating milestone', async () => {
    await expect(
        service.updateMilestone(null, 'In Transit', 'driver-1')
    ).rejects.toThrow('orderId is required.');

    await expect(
        service.updateMilestone(undefined, 'In Transit', 'driver-1')
    ).rejects.toThrow('orderId is required.');
});
});

describe('OrderLifecycleService.getOrderHistory', () => {
  let orderRepository;
  let service;

  beforeEach(() => {
    vi.clearAllMocks();
    orderRepository = {
      findOrdersWithCount: vi.fn(),
      findProfilesByIds: vi.fn(() => Promise.resolve({ data: [] })),
      findRatingsForCustomer: vi.fn(() => Promise.resolve({ data: [] })),
    };
    service = createService(orderRepository, {});
  });

  it('returns paginated history', async () => {
    orderRepository.findOrdersWithCount.mockResolvedValue({
      data: [{ id: 'order-1', driver_id: null }],
      error: null,
      count: 1,
    });

    const result = await service.getOrderHistory('cust-1', 1, 10);

    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.history).toHaveLength(1);
  });

  it('throws 500 when the history query fails', async () => {
    orderRepository.findOrdersWithCount.mockResolvedValue({ data: null, error: { message: 'DB down' }, count: 0 });

    await expect(service.getOrderHistory('cust-1', 1, 10)).rejects.toMatchObject({ status: 500 });
  });
});