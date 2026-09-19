import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { DomainError } from '../../../src/services/order/domainError.js';

vi.mock('../../../src/config/db.js', () => ({
  get supabase() { return { name: 'supabase' }; },
  get supabaseAdmin() { return { name: 'supabase-admin' }; },
  get redisClient() { return null; },
  get mongoDb() { return null; },
  get firebaseAdmin() { return null; },
}));

vi.mock('../../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../src/core/performanceMetrics.js', () => ({
  measureExecution: (name, fn) => fn(),
}));

const ORDER = {
  id: 'order-idemp-1',
  order_display_id: 'TRX-IDEMP-01',
  driver_id: 'driver-idemp-1',
  customer_id: 'customer-idemp-1',
  escrow_status: 'funded',
  escrow_release_attempts: 0,
  status: 'arriving',
  delivery_verification_status: 'pending_verification',
  release_tx_hash: null,
  drop_lat: 19.076,
  drop_lng: 72.877,
  total_amount: 55000, // 550.00 INR
  escrow_amount_wei: '600000000000000000',
};

const VALID_OTP = '849201';
const VALID_OTP_HASH = crypto.createHash('sha256').update(VALID_OTP).digest('hex');

const DIFFERENT_OTP = '391048';
const DIFFERENT_OTP_HASH = crypto.createHash('sha256').update(DIFFERENT_OTP).digest('hex');

const { DeliveryVerificationService } = await import(
  '../../../src/services/order/deliveryVerificationService.js'
);

describe('DeliveryVerificationService - Idempotency and Replay Prevention', () => {
  let repo;
  let escrowReleaseFn;
  let notificationService;

  beforeEach(() => {
    let readCount = 0;
    repo = {
      findOrderById: vi.fn().mockImplementation(() => {
        readCount++;
        if (readCount === 1) {
          return Promise.resolve({ data: { ...ORDER }, error: null });
        }
        return Promise.resolve({
          data: {
            ...ORDER,
            status: 'payment_released',
            escrow_status: 'released',
            escrow_release_attempts: 1,
            release_tx_hash: '0xabc123def456',
            delivery_verification_status: 'delivered',
          },
          error: null,
        });
      }),
      updateOrderGuardStatus: vi.fn().mockResolvedValue({ data: { id: ORDER.id }, error: null }),
      executeRpc: vi.fn().mockResolvedValue({
        data: { driver_id: ORDER.driver_id, order_display_id: ORDER.order_display_id },
        error: null,
      }),
      updateOrder: vi.fn().mockResolvedValue({ data: { id: ORDER.id }, error: null }),
      updateWalletTransaction: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    escrowReleaseFn = vi.fn().mockResolvedValue({
      txHash: '0xabc123def456',
      alreadyReleased: false,
    });

    notificationService = {
      getActiveDeliveryOtp: vi.fn().mockResolvedValue({
        id: 'otp-record-1',
        order_id: ORDER.id,
        otp_hash: VALID_OTP_HASH,
        expires_at: new Date(Date.now() + 600000).toISOString(),
        verified: false,
        used_at: null,
      }),
      getConsumedDeliveryOtp: vi.fn().mockResolvedValue(null),
      consumeDeliveryOtpAtomic: vi.fn().mockResolvedValue(true),
      resetDeliveryOtpConsumption: vi.fn().mockResolvedValue(true),
      verifyDeliveryOtpHash: vi.fn((inputOtp, record) => {
        const expectedHash = typeof record === 'string' ? record : record?.otp_hash;
        const inputHash = crypto.createHash('sha256').update(String(inputOtp).trim()).digest('hex');
        return inputHash === expectedHash;
      }),
      verifyDeliveryOtp: vi.fn().mockResolvedValue(true),
      storeDeliveryOtp: vi.fn().mockResolvedValue(true),
      sendDeliveryOtpNotification: vi.fn().mockResolvedValue({ success: true }),
      sendPushNotification: vi.fn().mockResolvedValue(undefined),
    };
  });

  function createService(overrides = {}) {
    const svc = new DeliveryVerificationService(repo, {
      notificationService,
      escrowReleaseFn,
      trackingTokenService: null,
      ...overrides,
    });
    svc.assertDriverAtDropoff = vi.fn().mockResolvedValue();
    return svc;
  }

  describe('Happy path & Smart Contract Idempotency Key', () => {
    it('atomically consumes OTP and passes deterministic idempotency key to escrowRelease', async () => {
      const svc = createService();

      const result = await svc.verifyDelivery(
        { orderId: ORDER.id, driverId: ORDER.driver_id, otp: VALID_OTP },
        {}
      );

      // 1. Must consume OTP atomically prior to on-chain release
      expect(notificationService.consumeDeliveryOtpAtomic).toHaveBeenCalledWith('otp-record-1', ORDER.id);

      // 2. Order status set to 'verifying'
      expect(repo.updateOrder).toHaveBeenCalledWith(ORDER.id, expect.objectContaining({
        delivery_verification_status: 'verifying',
      }));

      // 3. Deterministic releaseIdempotencyKey passed to escrow release
      expect(escrowReleaseFn).toHaveBeenCalledTimes(1);
      const [calledDisplayId, calledAmountWei, calledIdempKey] = escrowReleaseFn.mock.calls[0];
      expect(calledDisplayId).toBe(ORDER.order_display_id);
      expect(calledAmountWei).toBe(BigInt(ORDER.escrow_amount_wei));
      expect(calledIdempKey).toMatch(/^0x[a-f0-9]{64}$/i);

      // 4. complete_trip_tx called to finalize DB state
      expect(repo.executeRpc).toHaveBeenCalledWith(
        'complete_trip_tx',
        expect.objectContaining({
          p_order_id: ORDER.id,
          p_otp_id: 'otp-record-1',
          p_release_tx_hash: '0xabc123def456',
        }),
        expect.anything()
      );

      // 5. Response payload conforms to standard contract
      expect(result).toMatchObject({
        success: true,
        payment_released: true,
        amount_inr: 550,
        order_display_id: ORDER.order_display_id,
        escrowUpdateFailed: false,
      });
    });
  });

  describe('Replay of same OTP on already completed order', () => {
    it('returns existing success idempotently without double escrow release when same OTP is supplied', async () => {
      // Order is already marked completed / payment_released
      repo.findOrderById = vi.fn().mockResolvedValue({
        data: {
          ...ORDER,
          status: 'payment_released',
          escrow_status: 'released',
          release_tx_hash: '0xEXISTING_TX_HASH',
          delivery_verification_status: 'delivered',
        },
        error: null,
      });

      // OTP was already consumed
      notificationService.getConsumedDeliveryOtp = vi.fn().mockResolvedValue({
        id: 'otp-record-1',
        order_id: ORDER.id,
        otp_hash: VALID_OTP_HASH,
        verified: true,
        used_at: new Date(Date.now() - 30000).toISOString(),
      });

      const svc = createService();

      const result = await svc.verifyDelivery(
        { orderId: ORDER.id, driverId: ORDER.driver_id, otp: VALID_OTP },
        {}
      );

      // Must NOT invoke escrow release again!
      expect(escrowReleaseFn).not.toHaveBeenCalled();

      // Must NOT re-consume or execute RPC
      expect(notificationService.consumeDeliveryOtpAtomic).not.toHaveBeenCalled();
      expect(repo.executeRpc).not.toHaveBeenCalled();

      // Must return successful idempotent response
      expect(result).toMatchObject({
        success: true,
        payment_released: true,
        amount_inr: 550,
        order_display_id: ORDER.order_display_id,
        escrowUpdateFailed: false,
      });
    });
  });

  describe('Replay attack prevention: different OTP on completed or in-flight order', () => {
    it('rejects with 409 OTP_ALREADY_USED when a DIFFERENT OTP is submitted for an already completed order', async () => {
      repo.findOrderById = vi.fn().mockResolvedValue({
        data: {
          ...ORDER,
          status: 'payment_released',
          escrow_status: 'released',
          delivery_verification_status: 'delivered',
        },
        error: null,
      });

      // Stored consumed OTP matches VALID_OTP, but caller submits DIFFERENT_OTP
      notificationService.getConsumedDeliveryOtp = vi.fn().mockResolvedValue({
        id: 'otp-record-1',
        order_id: ORDER.id,
        otp_hash: VALID_OTP_HASH,
        verified: true,
      });

      const svc = createService();

      await expect(
        svc.verifyDelivery(
          { orderId: ORDER.id, driverId: ORDER.driver_id, otp: DIFFERENT_OTP },
          {}
        )
      ).rejects.toMatchObject({
        status: 409,
        payload: { code: 'OTP_ALREADY_USED' },
      });

      // No financial action taken
      expect(escrowReleaseFn).not.toHaveBeenCalled();
      expect(repo.executeRpc).not.toHaveBeenCalled();
    });

    it('rejects with 409 OTP_ALREADY_USED when a DIFFERENT OTP is submitted on an order with consumed OTP', async () => {
      // Active OTP query returns null because it was already consumed
      notificationService.getActiveDeliveryOtp = vi.fn().mockResolvedValue(null);

      // Consumed OTP exists with VALID_OTP_HASH
      notificationService.getConsumedDeliveryOtp = vi.fn().mockResolvedValue({
        id: 'otp-record-1',
        order_id: ORDER.id,
        otp_hash: VALID_OTP_HASH,
        used_at: new Date().toISOString(),
        verified: false,
      });

      const svc = createService();

      await expect(
        svc.verifyDelivery(
          { orderId: ORDER.id, driverId: ORDER.driver_id, otp: DIFFERENT_OTP },
          {}
        )
      ).rejects.toMatchObject({
        status: 409,
        payload: { code: 'OTP_ALREADY_USED' },
      });

      expect(escrowReleaseFn).not.toHaveBeenCalled();
    });
  });

  describe('Network Failure and Recovery Resilience', () => {
    it('resets OTP consumption and marks verification status failed when blockchain release throws network error', async () => {
      escrowReleaseFn = vi.fn().mockRejectedValue(new Error('Network timeout connecting to Polygon RPC'));

      const svc = createService();

      await expect(
        svc.verifyDelivery(
          { orderId: ORDER.id, driverId: ORDER.driver_id, otp: VALID_OTP },
          {}
        )
      ).rejects.toThrow('Blockchain escrow release failed');

      // OTP consumption MUST be reset so the driver can retry!
      expect(notificationService.resetDeliveryOtpConsumption).toHaveBeenCalledWith('otp-record-1', ORDER.id);

      // Order delivery verification status set to 'failed'
      expect(repo.updateOrder).toHaveBeenCalledWith(ORDER.id, expect.objectContaining({
        delivery_verification_status: 'failed',
      }));

      // Trip completion RPC must NOT have run
      expect(repo.executeRpc).not.toHaveBeenCalled();
    });

    it('handles retry where blockchain already released payment (alreadyReleased = true) safely', async () => {
      // On retry, smart contract reports alreadyReleased = true
      escrowReleaseFn = vi.fn().mockResolvedValue({
        txHash: null,
        alreadyReleased: true,
      });

      const svc = createService();

      const result = await svc.verifyDelivery(
        { orderId: ORDER.id, driverId: ORDER.driver_id, otp: VALID_OTP },
        {}
      );

      // Should complete trip and update status to delivered without throwing
      expect(repo.executeRpc).toHaveBeenCalledWith(
        'complete_trip_tx',
        expect.objectContaining({
          p_order_id: ORDER.id,
          p_otp_id: 'otp-record-1',
        }),
        expect.anything()
      );

      expect(repo.updateOrder).toHaveBeenCalledWith(ORDER.id, expect.objectContaining({
        delivery_verification_status: 'delivered',
      }));

      expect(result).toMatchObject({
        success: true,
        payment_released: true,
        amount_inr: 550,
        order_display_id: ORDER.order_display_id,
      });
    });
  });
});
