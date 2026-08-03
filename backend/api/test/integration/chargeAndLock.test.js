import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const CUSTOMER_ID = 'cust-123';
const DRIVER_ID = 'driver-456';
const DRIVER_WALLET = '0xDriverWallet000000000000000000000000000000000';
const BOOKING_ID = '0xbooking1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

function buildApp(router) {
  const app = express();
  app.use(express.json());
  app.use('/api/payments', router);
  return app;
}

describe('POST /api/payments/charge-and-lock', () => {
  let mockFindOrder;
  let mockUpdateOrderWithFilter;
  let mockVerifyCapture;
  let mockBuildDepositTx;
  let mockIsEscrowEnabled;
  let mockCreatePaymentOrder;
  let mockPaisaToMaticWei;

  const mockOrder = (overrides = {}) => ({
    id: 'order-abc',
    order_display_id: 'TX1001',
    customer_id: CUSTOMER_ID,
    driver_id: DRIVER_ID,
    total_amount: 50000,
    escrow_status: 'pending',
    escrow_booking_id: null,
    wallet_address: '0xCustomerWallet0000000000000000000000000000000',
    ...overrides,
  });

  beforeEach(async () => {
    vi.restoreAllMocks();

    process.env.NODE_ENV = 'test';
    process.env.BYPASS_AUTH = 'true';
    process.env.ENABLE_TEST_AUTH = 'true';

    mockFindOrder = vi.fn();
    mockUpdateOrderWithFilter = vi.fn();
    mockVerifyCapture = vi.fn();
    mockBuildDepositTx = vi.fn();
    mockIsEscrowEnabled = vi.fn().mockReturnValue(true);
    mockCreatePaymentOrder = vi.fn();
    mockPaisaToMaticWei = vi.fn().mockReturnValue(100n);

    vi.resetModules();
    vi.doMock('../../src/core/container.js', () => ({
      orderRepository: {
        findOrderByIdOrDisplayId: mockFindOrder,
        updateOrderWithFilter: mockUpdateOrderWithFilter,
      },
    }));
    vi.doMock('../../src/config/db.js', () => ({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { polygon_wallet_address: DRIVER_WALLET },
                error: null,
              }),
            }),
          }),
        }),
      },
      supabaseAdmin: null,
      redisClient: null,
      firebaseAdmin: null,
    }));
    vi.doMock('../../src/lib/redisLock.js', () => ({
      acquireLock: async () => 'lock-value',
      releaseLock: async () => true,
      renewLock: async () => true,
    }));
    vi.doMock('../../src/services/escrow.js', () => ({
      recordDepositTx: vi.fn(),
      getEscrowBookingId: vi.fn(() => BOOKING_ID),
      paisaToMaticWei: mockPaisaToMaticWei,
      isEscrowEnabled: mockIsEscrowEnabled,
      buildDepositTx: mockBuildDepositTx,
    }));
    vi.doMock('../../src/services/payment/UpiPaymentService.js', () => ({
      default: {
        verifyPaymentCaptured: mockVerifyCapture,
        createPaymentOrder: mockCreatePaymentOrder,
        processDriverPayout: vi.fn(),
      },
    }));
    vi.doMock('../../src/middleware/auditLog.js', () => ({
      auditLog: () => (req, res, next) => next(),
    }));
    vi.doMock('../../src/services/notificationService.js', () => ({
      sendPushNotification: vi.fn().mockResolvedValue(true),
    }));
  });

  afterEach(() => {
    delete process.env.BYPASS_AUTH;
    delete process.env.ENABLE_TEST_AUTH;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function bootApp() {
    const mod = await import('../../src/routes/paymentRoutes.js');
    return buildApp(mod.default);
  }

  function authenticatedRequest(app) {
    return request(app)
      .post('/api/payments/charge-and-lock')
      .set('x-user-id', CUSTOMER_ID);
  }

  it('refuses to fund an order when no real payment capture can be verified — an unpaid order never reaches funded', async () => {
    mockFindOrder.mockResolvedValue({ data: mockOrder(), error: null });
    mockVerifyCapture.mockResolvedValue({ captured: false, reason: 'payment_gateway_not_configured' });

    const app = await bootApp();
    const res = await authenticatedRequest(app).send({
      order_id: 'order-abc',
      customer_upi_id: 'customer@upi',
    });

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('Payment capture could not be verified');
    expect(res.body.escrow_status).toBeUndefined();
    // An unpaid order must never have any database write applied…
    expect(mockUpdateOrderWithFilter).not.toHaveBeenCalled();
    // …and no deposit transaction may be built for it.
    expect(mockBuildDepositTx).not.toHaveBeenCalled();
    // No mock/placeholder payment order may be fabricated either.
    expect(mockCreatePaymentOrder).not.toHaveBeenCalled();
  });

  it('returns 409 when the order is already funded', async () => {
    mockFindOrder.mockResolvedValue({ data: mockOrder({ escrow_status: 'funded' }), error: null });

    const app = await bootApp();
    const res = await authenticatedRequest(app).send({
      order_id: 'order-abc',
      customer_upi_id: 'customer@upi',
    });

    expect(res.status).toBe(409);
    expect(res.body.escrow_status).toBe('funded');
    expect(mockVerifyCapture).not.toHaveBeenCalled();
    expect(mockUpdateOrderWithFilter).not.toHaveBeenCalled();
  });

  it('moves a captured order to funding (never funded) and returns an unsigned customer deposit tx', async () => {
    mockFindOrder.mockResolvedValue({ data: mockOrder(), error: null });
    mockVerifyCapture.mockResolvedValue({ captured: true });
    mockBuildDepositTx.mockResolvedValue({
      txData: { to: '0xEscrowContract', data: '0xdeadbeef', value: 100n },
      bookingId: BOOKING_ID,
    });
    mockUpdateOrderWithFilter.mockResolvedValue({
      data: { escrow_status: 'funding' },
      error: null,
    });

    const app = await bootApp();
    const res = await authenticatedRequest(app).send({
      order_id: 'order-abc',
      customer_upi_id: 'customer@upi',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.escrow_status).toBe('funding');
    expect(res.body.booking_id).toBe(BOOKING_ID);
    // bigint `value` must be serialized as a decimal string.
    expect(res.body.deposit_tx.value).toBe('100');

    // The escrow deposit is built for the CUSTOMER's wallet, not funded by the relayer.
    expect(mockBuildDepositTx).toHaveBeenCalledWith('TX1001', DRIVER_WALLET, 100n);

    expect(mockUpdateOrderWithFilter).toHaveBeenCalledTimes(1);
    const [orderId, updates, filters] = mockUpdateOrderWithFilter.mock.calls[0];
    expect(orderId).toBe('order-abc');
    // Only the intermediate 'funding' state may be persisted.
    expect(updates.escrow_status).toBe('funding');
    expect(updates.escrow_amount_wei).toBe('100');
    expect(updates.escrow_driver_wallet).toBe(DRIVER_WALLET);
    expect(filters).toEqual([{ op: 'eq', column: 'escrow_status', value: 'pending' }]);
  });

  it('rejects unauthenticated requests before touching the order', async () => {
    const app = await bootApp();
    const res = await request(app)
      .post('/api/payments/charge-and-lock')
      .send({ order_id: 'order-abc', customer_upi_id: 'customer@upi' });

    expect(res.status).toBe(401);
    expect(mockFindOrder).not.toHaveBeenCalled();
  });
});
