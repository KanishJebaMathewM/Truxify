import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import orderRoutes from '../../src/routes/orderRoutes.js';

const { repo, validation, depositMock } = vi.hoisted(() => ({
  repo: {
    findOrderByIdOrDisplayId: vi.fn(),
    findCustomerWallet: vi.fn(),
    executeRpc: vi.fn(),
    updateOrder: vi.fn(),
    updateOrderWithFilter: vi.fn(),
    revertEscrowStatus: vi.fn(),
  },
  validation: {
    findOrderByIdOrDisplayId: vi.fn(),
    assertOrderFound: vi.fn(),
    assertCustomerOwnership: vi.fn(),
    assertEscrowState: vi.fn(),
  },
  depositMock: {
    recordDepositTx: vi.fn(),
  },
}));

vi.mock('../../src/core/container.js', () => ({
  orderRepository: repo,
  orderValidationService: validation,
  orderTimelineService: {},
  orderMilestoneService: {},
  orderLifecycleService: {},
  deliveryVerificationService: {},
  buildDepositTx: vi.fn(),
  recordDepositTx: depositMock.recordDepositTx,
  confirmEscrowRefund: vi.fn(),
  submitEscrowRefund: vi.fn(),
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = req.user || { id: 'u1' };
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  bidLimiter: (_req, _res, next) => next(),
  userLimiter: (_req, _res, next) => next(),
  userKeyGenerator: () => 'key',
  podUploadLimiter: (_req, _res, next) => next(),
  createStore: () => ({}),
  verifyDeliveryLimiter: (_req, _res, next) => next(),
  resendOtpLimiter: (_req, _res, next) => next(),
  changeDropLimiter: (_req, _res, next) => next(),
  predictDemandLimiter: (_req, _res, next) => next(),
  telemetryLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/idempotency.js', () => ({
  requireIdempotency: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/lib/redisLock.js', () => ({
  acquireLock: vi.fn(async () => 'lock-value'),
  releaseLock: vi.fn(async () => {}),
}));

vi.mock('../../src/middleware/auditLog.js', () => ({
  auditLog: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: () => (_req, _res, next) => next(),
  validateParams: () => (_req, _res, next) => next(),
  validateQuery: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: { from: vi.fn() },
  supabase: {},
  mongoDb: {},
  redisClient: {},
  createUserClient: () => ({}),
}));

vi.mock('../../src/services/escrow.js', () => ({
  getEscrowBookingId: () => 'booking-1',
  resolveExpectedDepositAmount: () => ({ expectedAmountWei: '1000' }),
  paisaToMaticWei: () => '1000',
  submitEscrowRefund: vi.fn(async () => ({
    txHash: '0xrefund',
    waitForConfirmation: async () => {},
  })),
}));

vi.mock('../../src/services/notificationService.js', () => ({
  expireDeliveryOtps: vi.fn(),
  sendPushNotification: vi.fn(async () => {}),
}));

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 'u1' };
  next();
});
app.use(orderRoutes);

const VALID_TX = `0x${'a'.repeat(64)}`;

function buildOrder(overrides = {}) {
  return {
    id: 'order-1',
    order_display_id: 'ORD-1',
    customer_id: 'u1',
    escrow_booking_id: 'booking-1',
    escrow_status: 'funding',
    escrow_amount_wei: '1000',
    escrow_driver_wallet: '0xdriver',
    pending_bid_acceptance: {
      bid_id: 'bid-1',
      load_id: 'load-1',
      driver_id: 'd1',
      truck_id: 't1',
      driver_name: 'Driver',
      driver_rating: 4.5,
      truck_number: 'MH01',
      bid_amount: 50000,
      order_display_id: 'ORD-1',
      version: 1,
    },
    ...overrides,
  };
}

describe('POST /api/orders/:id/confirm-deposit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validation.findOrderByIdOrDisplayId.mockResolvedValue(buildOrder());
    validation.assertOrderFound.mockReturnValue(undefined);
    validation.assertCustomerOwnership.mockReturnValue(undefined);
    validation.assertEscrowState.mockReturnValue(undefined);
    repo.findCustomerWallet.mockResolvedValue({
      data: { polygon_wallet_address: '0xcustomer' },
    });
    repo.updateOrder.mockResolvedValue({ data: { id: 'order-1' }, error: null });
    repo.updateOrderWithFilter.mockResolvedValue({
      data: { id: 'order-1' },
      error: null,
    });
    repo.revertEscrowStatus.mockResolvedValue({ data: {}, error: null });
    depositMock.recordDepositTx.mockResolvedValue({
      error: null,
      alreadyFunded: false,
      txHash: '0xdep',
    });
  });

  it('clears pending_bid_acceptance and reverts escrow when acceptance fails (409)', async () => {
    repo.executeRpc.mockResolvedValue({ error: { message: 'accept failed' } });

    const res = await request(app)
      .post('/order-1/confirm-deposit')
      .send({ txHash: VALID_TX });

    expect(res.status).toBe(409);
    expect(repo.updateOrder).toHaveBeenCalledWith('order-1', {
      pending_bid_acceptance: null,
    });
    expect(repo.revertEscrowStatus).toHaveBeenCalledWith('order-1');
  });

  it('succeeds (200) and accepts the bid on a subsequent deposit+confirm', async () => {
    repo.executeRpc.mockResolvedValue({ error: null });

    const res = await request(app)
      .post('/order-1/confirm-deposit')
      .send({ txHash: VALID_TX });

    expect(res.status).toBe(200);
    expect(repo.executeRpc).toHaveBeenCalledWith(
      'accept_bid_tx',
      expect.objectContaining({ p_bid_id: 'bid-1' }),
      expect.anything(),
    );
  });
});
