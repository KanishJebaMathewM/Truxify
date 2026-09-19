import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  get supabase() { return { name: 'supabase' }; },
  get supabaseAdmin() { return { name: 'supabase-admin' }; },
  get redisClient() { return null; },
  get mongoDb() { return null; },
  get firebaseAdmin() { return null; },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/core/performanceMetrics.js', () => ({
  measureExecution: (name, fn) => fn(),
}));

vi.mock('../../src/services/notificationService.js', () => ({
  sendDeliveryOtpNotification: vi.fn(),
  storeDeliveryOtp: vi.fn(),
  getActiveDeliveryOtp: vi.fn(),
  verifyDeliveryOtp: vi.fn(),
  verifyDeliveryOtpHash: vi.fn(),
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/escrow.js', () => ({
  escrowRelease: vi.fn(),
  resolveExpectedDepositAmount: (order) => {
    if (order?.escrow_amount_wei != null) {
      return { expectedAmountWei: BigInt(order.escrow_amount_wei) };
    }
    if (order?.pending_bid_acceptance?.bid_amount != null) {
      return { expectedAmountWei: BigInt(order.pending_bid_acceptance.bid_amount) * 4000000000000n };
    }
    return { error: 'no amount on file', code: 'ESCROW_AMOUNT_MISSING' };
  },
  paisaToMaticWei: (paisa) => BigInt(Math.round(Number(paisa))) * 4000000000000n,
  weiWithinTolerance: () => true,
}));

const { DeliveryVerificationService } = await import(
  '../../src/services/order/deliveryVerificationService.js'
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
  total_amount: 55000,
  escrow_amount_wei: '600000000000000000',
};

function makeOrderRepository(readOrder = ORDER) {
  let readCount = 0;
  return {
    findOrderById: () => {
      readCount++;
      if (readCount === 1) {
        return Promise.resolve({ data: readOrder, error: null });
      }
      return Promise.resolve({
        data: { status: 'payment_released', escrow_status: 'released', escrow_release_attempts: 1 },
        error: null,
      });
    },
    updateOrderGuardStatus: vi.fn().mockResolvedValue({ data: { id: 'order-1' }, error: null }),
    executeRpc: vi.fn().mockResolvedValue({
      data: { driver_id: 'driver-1', order_display_id: 'OD-1' },
      error: null,
    }),
    updateOrder: vi.fn().mockResolvedValue({ data: { id: 'order-1' }, error: null }),
    updateWalletTransaction: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

function makeService({ repo = makeOrderRepository(), notificationOverrides = {} } = {}) {
  const notificationService = {
    getActiveDeliveryOtp: () => Promise.resolve({ id: 'otp-1' }),
    getConsumedDeliveryOtp: () => Promise.resolve(null),
    consumeDeliveryOtpAtomic: () => Promise.resolve(true),
    resetDeliveryOtpConsumption: () => Promise.resolve(true),
    verifyDeliveryOtpHash: () => true,
    verifyDeliveryOtp: () => Promise.resolve(true),
    storeDeliveryOtp: () => Promise.resolve(true),
    sendDeliveryOtpNotification: () => Promise.resolve({ success: true }),
    ...notificationOverrides,
  };
  const svc = new DeliveryVerificationService(repo, {
    notificationService,
    escrowReleaseFn: vi.fn().mockResolvedValue({ txHash: '0xRELEASE', alreadyReleased: false }),
    trackingTokenService: null,
  });
  svc.assertDriverAtDropoff = vi.fn().mockResolvedValue();
  return svc;
}

describe('deliveryVerificationService', () => {
  describe('verifyDelivery', () => {
    it('verifies delivery when order is arriving and OTP matches', async () => {
      const repo = makeOrderRepository();
      const svc = makeService({ repo });

      const result = await svc.verifyDelivery(
        { orderId: 'order-1', driverId: 'driver-1', otp: '123456' },
        {},
      );

      expect(repo.executeRpc).toHaveBeenCalledWith(
        'complete_trip_tx',
        expect.objectContaining({ p_order_id: 'order-1' }),
        expect.anything(),
      );
      expect(result).toMatchObject({
        escrowUpdateFailed: false,
        payment_released: true,
      });
    });

    it('throws when order is not in a delivery-ready status', async () => {
      const repo = makeOrderRepository({ ...ORDER, status: 'pending' });
      const svc = makeService({ repo });

      await expect(
        svc.verifyDelivery({ orderId: 'order-1', driverId: 'driver-1', otp: '123456' }, {}),
      ).rejects.toThrow();
    });

    it('throws when order not found', async () => {
      const repo = makeOrderRepository(null);
      const svc = makeService({ repo });

      await expect(
        svc.verifyDelivery({ orderId: 'order-nonexistent', driverId: 'driver-1', otp: '123456' }, {}),
      ).rejects.toThrow();
    });

    it('throws when driver is not assigned to the order', async () => {
      const repo = makeOrderRepository({ ...ORDER, driver_id: 'other-driver' });
      const svc = makeService({ repo });

      await expect(
        svc.verifyDelivery({ orderId: 'order-1', driverId: 'driver-1', otp: '123456' }, {}),
      ).rejects.toThrow('Access Denied');
    });
  });
});