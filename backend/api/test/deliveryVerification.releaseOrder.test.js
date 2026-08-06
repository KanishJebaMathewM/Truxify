import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/db.js', () => ({
  get supabase() { return { name: 'supabase' }; },
  get supabaseAdmin() { return { name: 'supabase-admin' }; },
  get redisClient() { return null; },
  get mongoDb() { return null; },
  get firebaseAdmin() { return null; },
}));

vi.mock('../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/core/performanceMetrics.js', () => ({
  measureExecution: (name, fn) => fn(),
}));

vi.mock('../src/services/escrow.js', () => ({
  escrowRelease: vi.fn(),
}));

const { DeliveryVerificationService } = await import(
  '../src/services/order/deliveryVerificationService.js'
);

const ORDER = {
  id: 'order-1',
  order_display_id: 'OD-1',
  driver_id: 'driver-1',
  customer_id: 'customer-1',
  escrow_status: 'funded',
  escrow_release_attempts: 0,
  status: 'arriving',
  release_tx_hash: null,
  drop_lat: 19.076,
  drop_lng: 72.877,
  toll_estimate: 0,
  base_freight: 50000,
  platform_fee: 5000,
  total_amount: 55000,
};

function makeOrderRepository() {
  let readCount = 0;
  return {
    findOrderById: () => {
      readCount++;
      if (readCount === 1) {
        return Promise.resolve({ data: ORDER, error: null });
      }
      // post-RPC verification read
      return Promise.resolve({
        data: { status: 'payment_released', escrow_status: 'released', escrow_release_attempts: 1 },
        error: null,
      });
    },
    updateOrderGuardStatus: vi.fn().mockResolvedValue({ data: { id: 'order-1' }, error: null }),
    executeRpc: vi.fn().mockResolvedValue({ data: { driver_id: 'driver-1', order_display_id: 'OD-1' }, error: null }),
    updateOrder: vi.fn().mockResolvedValue({ data: { id: 'order-1' }, error: null }),
    updateWalletTransaction: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

function makeService({ escrowReleaseFn } = {}) {
  return new DeliveryVerificationService(null, {
    notificationService: {
      getActiveDeliveryOtp: () => Promise.resolve({ id: 'otp-1' }),
      verifyDeliveryOtpHash: () => true,
      verifyDeliveryOtp: () => Promise.resolve(true),
      storeDeliveryOtp: () => Promise.resolve(true),
      sendDeliveryOtpNotification: () => Promise.resolve({ success: true }),
    },
    escrowReleaseFn,
    trackingTokenService: null,
  });
}

describe('verifyDelivery escrow-before-RPC ordering (issue #4996)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('releases escrow first and passes the resulting tx hash to complete_trip_tx', async () => {
    const releaseOrder = [];
    const releaseFn = vi.fn().mockImplementation(() => {
      releaseOrder.push('release');
      return Promise.resolve({ txHash: '0xRELEASE', alreadyReleased: false });
    });
    const repo = makeOrderRepository();
    repo.executeRpc.mockImplementation(() => {
      releaseOrder.push('rpc');
      return Promise.resolve({ data: { driver_id: 'driver-1', order_display_id: 'OD-1' }, error: null });
    });

    const svc = makeService({ escrowReleaseFn: releaseFn });
    svc.orderRepository = repo;
    svc.assertDriverAtDropoff = vi.fn().mockResolvedValue();

    const result = await svc.verifyDelivery(
      { orderId: 'order-1', driverId: 'driver-1', otp: '123456' },
      {},
    );

    expect(releaseOrder).toEqual(['release', 'rpc']);
    expect(repo.executeRpc).toHaveBeenCalledWith(
      'complete_trip_tx',
      expect.objectContaining({ p_release_tx_hash: '0xRELEASE' }),
      expect.anything(),
    );
    // The confirmed release outcome is persisted before the RPC runs so a
    // later RPC failure is recoverable.
    expect(repo.updateOrder).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ escrow_status: 'released', release_tx_hash: '0xRELEASE' }),
    );
    expect(result).toEqual({ escrowUpdateFailed: false });
  });

  it('does not call complete_trip_tx when the on-chain release fails (retryable 503)', async () => {
    const repo = makeOrderRepository();
    const svc = makeService({
      escrowReleaseFn: () => Promise.reject(new Error('on-chain timeout')),
    });
    svc.orderRepository = repo;
    svc.assertDriverAtDropoff = vi.fn().mockResolvedValue();

    await expect(
      svc.verifyDelivery({ orderId: 'order-1', driverId: 'driver-1', otp: '123456' }, {}),
    ).rejects.toMatchObject({ status: 503, payload: { retryable: true } });

    expect(repo.executeRpc).not.toHaveBeenCalled();
  });

  it('is idempotent when the release already completed (alreadyReleased)', async () => {
    const repo = makeOrderRepository();
    const svc = makeService({
      escrowReleaseFn: () =>
        Promise.resolve({ txHash: null, alreadyReleased: true }),
    });
    svc.orderRepository = repo;
    svc.assertDriverAtDropoff = vi.fn().mockResolvedValue();

    const result = await svc.verifyDelivery(
      { orderId: 'order-1', driverId: 'driver-1', otp: '123456' },
      {},
    );

    expect(repo.executeRpc).toHaveBeenCalled();
    expect(repo.executeRpc.mock.calls[0][1].p_release_tx_hash).toBe(null);
    expect(repo.updateOrder).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ escrow_status: 'released' }),
    );
    expect(result.escrowUpdateFailed).toBe(false);
  });
});
