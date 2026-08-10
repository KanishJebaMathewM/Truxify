/**
 * Unit tests for POST /api/payments/lock accept_bid_tx after funding (#9282).
 *
 * Run with: npx vitest run test/unit/paymentRoutesLockAcceptBid.test.js
 */
process.env.BYPASS_AUTH = 'true';
process.env.ENABLE_TEST_AUTH = 'true';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockFindOrderByIdOrDisplayId = vi.fn();
const mockFindCustomerWallet = vi.fn();
const mockUpdateOrderWithFilter = vi.fn();
const mockExecuteRpc = vi.fn();
const mockUpdateOrder = vi.fn();
const mockRevertEscrowStatus = vi.fn();
const mockRecordDepositTx = vi.fn();
const mockResolveExpectedDepositAmount = vi.fn();
const mockSubmitEscrowRefund = vi.fn();
const mockSendPushNotification = vi.fn();

vi.mock('../../src/core/container.js', () => ({
  orderRepository: {
    findCustomerWallet: (...args) => mockFindCustomerWallet(...args),
    updateOrderWithFilter: (...args) => mockUpdateOrderWithFilter(...args),
    executeRpc: (...args) => mockExecuteRpc(...args),
    updateOrder: (...args) => mockUpdateOrder(...args),
    revertEscrowStatus: (...args) => mockRevertEscrowStatus(...args),
  },
  orderValidationService: {
    findOrderByIdOrDisplayId: (...args) => mockFindOrderByIdOrDisplayId(...args),
  },
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: {},
  createUserClient: vi.fn(),
}));

vi.mock('../../src/lib/redisLock.js', () => ({
  acquireLock: vi.fn().mockResolvedValue('lock-token'),
  releaseLock: vi.fn(),
  LockAcquisitionError: class LockAcquisitionError extends Error {},
}));

vi.mock('../../src/services/escrow.js', () => ({
  recordDepositTx: (...args) => mockRecordDepositTx(...args),
  getEscrowBookingId: (id) => `booking-${id}`,
  paisaToMaticWei: vi.fn(),
  isEscrowEnabled: vi.fn(() => true),
  escrowLockPayment: vi.fn(),
  resolveExpectedDepositAmount: (...args) => mockResolveExpectedDepositAmount(...args),
  submitEscrowRefund: (...args) => mockSubmitEscrowRefund(...args),
}));

vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification: (...args) => mockSendPushNotification(...args),
}));

vi.mock('../../src/services/payment/UpiPaymentService.js', () => ({
  default: {},
}));

vi.mock('../../src/middleware/idempotency.js', () => ({
  requireIdempotency: () => (req, res, next) => next(),
}));

vi.mock('../../src/middleware/auditLog.js', () => ({
  auditLog: () => (req, res, next) => next(),
}));

const { default: paymentRouter } = await import('../../src/routes/paymentRoutes.js');

const TX_HASH = '0x' + 'a'.repeat(64);
const CUSTOMER_HEADERS = {
  'x-user-id': 'customer-uuid-123',
  'x-user-role': 'customer',
  'x-user-name': 'Test Customer',
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/payments', paymentRouter);
  return app;
}

const pendingBid = {
  bid_id: 'bid-1',
  load_id: 'load-1',
  driver_id: 'driver-pending',
  truck_id: 'truck-1',
  driver_name: 'Driver',
  driver_rating: 4.5,
  truck_number: 'TN-1',
  bid_amount: 150000,
  order_display_id: 'TX-1',
  version: 2,
};

describe('POST /api/payments/lock pending bid acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindCustomerWallet.mockResolvedValue({
      data: { polygon_wallet_address: '0x' + 'b'.repeat(40) },
    });
    mockResolveExpectedDepositAmount.mockReturnValue({ expectedAmountWei: 100n });
    mockRecordDepositTx.mockResolvedValue({ txHash: TX_HASH });
    mockUpdateOrderWithFilter.mockResolvedValue({ error: null });
    mockUpdateOrder.mockResolvedValue({ error: null });
    mockRevertEscrowStatus.mockResolvedValue(undefined);
    mockExecuteRpc.mockResolvedValue({ error: null });
    mockSendPushNotification.mockResolvedValue(undefined);
  });

  it('runs accept_bid_tx and notifies pending.driver_id on success', async () => {
    mockFindOrderByIdOrDisplayId.mockResolvedValue({
      id: 'order-1',
      order_display_id: 'TX-1',
      customer_id: 'customer-uuid-123',
      driver_id: null,
      escrow_status: 'funding',
      escrow_booking_id: 'booking-1',
      escrow_driver_wallet: null,
      pending_bid_acceptance: pendingBid,
    });

    const res = await request(buildApp())
      .post('/api/payments/lock')
      .set(CUSTOMER_HEADERS)
      .send({ order_id: 'order-1', tx_hash: TX_HASH });

    expect(res.status).toBe(201);
    expect(mockExecuteRpc).toHaveBeenCalledWith(
      'accept_bid_tx',
      expect.objectContaining({ p_bid_id: 'bid-1', p_driver_id: 'driver-pending' }),
      undefined,
    );
    expect(mockSendPushNotification).toHaveBeenCalledWith(
      'driver-pending',
      'Bid Accepted!',
      expect.any(String),
      'order_update',
      expect.any(Object),
    );
    expect(mockSubmitEscrowRefund).not.toHaveBeenCalled();
  });

  it('returns 503 and keeps funding when accept fails and refund is pending', async () => {
    mockFindOrderByIdOrDisplayId.mockResolvedValue({
      id: 'order-1',
      order_display_id: 'TX-1',
      customer_id: 'customer-uuid-123',
      driver_id: null,
      escrow_status: 'funding',
      escrow_booking_id: 'booking-1',
      escrow_driver_wallet: null,
      pending_bid_acceptance: pendingBid,
    });
    mockExecuteRpc.mockResolvedValue({ error: { message: 'version conflict' } });
    mockSubmitEscrowRefund.mockResolvedValue({ txHash: null, error: 'chain down' });

    const res = await request(buildApp())
      .post('/api/payments/lock')
      .set(CUSTOMER_HEADERS)
      .send({ order_id: 'order-1', tx_hash: TX_HASH });

    expect(res.status).toBe(503);
    expect(mockUpdateOrder).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ escrow_status: 'funding' }),
    );
  });
});
