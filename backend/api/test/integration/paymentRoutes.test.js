process.env.BYPASS_AUTH = 'true';
process.env.ENABLE_TEST_AUTH = 'true';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockFindOrderByIdOrDisplayId = vi.fn();

vi.mock('../../src/core/container.js', () => ({
  orderRepository: {},
  orderValidationService: {
    findOrderByIdOrDisplayId: (...args) => mockFindOrderByIdOrDisplayId(...args),
  },
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  },
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: null,
}));

vi.mock('../../src/lib/redisLock.js', () => ({
  acquireLock: vi.fn().mockResolvedValue('lock-token'),
  releaseLock: vi.fn(),
  LockAcquisitionError: class LockAcquisitionError extends Error {},
}));

vi.mock('../../src/services/escrow.js', () => ({
  recordDepositTx: vi.fn(),
  getEscrowBookingId: vi.fn(),
  paisaToMaticWei: vi.fn(),
  isEscrowEnabled: vi.fn(() => true),
  escrowLockPayment: vi.fn(),
  resolveExpectedDepositAmount: vi.fn(),
}));

vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification: vi.fn(),
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

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/payments', paymentRouter);
  return app;
}

const CUSTOMER_HEADERS = {
  'x-user-id': 'customer-uuid-123',
  'x-user-role': 'customer',
  'x-user-name': 'Test Customer',
};

describe('POST /api/payments/upi-intent', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.PLATFORM_UPI_ID = '';
    delete process.env.PLATFORM_UPI_ID;
    mockFindOrderByIdOrDisplayId.mockReset();
    mockFindOrderByIdOrDisplayId.mockResolvedValue({
      id: 'order-1',
      order_display_id: 'TX-1',
      customer_id: 'customer-uuid-123',
      total_amount: 150000,
      escrow_status: 'pending',
      status: 'confirmed',
    });
  });

  afterEach(() => {
    delete process.env.PLATFORM_UPI_ID;
  });

  it('returns 503 instead of a fabricated UPI ID when PLATFORM_UPI_ID is not configured', async () => {
    const res = await request(buildApp())
      .post('/api/payments/upi-intent')
      .set(CUSTOMER_HEADERS)
      .send({ order_id: 'order-1', customer_upi_id: 'customer@upi' });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('UPI payments are not configured on the server.');
  });

  it('returns the configured platform UPI ID when PLATFORM_UPI_ID is set', async () => {
    process.env.PLATFORM_UPI_ID = 'payments@truxify';

    const res = await request(buildApp())
      .post('/api/payments/upi-intent')
      .set(CUSTOMER_HEADERS)
      .send({ order_id: 'order-1', customer_upi_id: 'customer@upi' });

    expect(res.status).toBe(200);
    expect(res.body.upi_id).toBe('payments@truxify');
    expect(res.body.amount_inr).toBe('1500.00');
    expect(res.body.order_ref).toBe('TX-1');
    expect(res.body.deep_link).toContain('pa=payments%40truxify');
  });
});
