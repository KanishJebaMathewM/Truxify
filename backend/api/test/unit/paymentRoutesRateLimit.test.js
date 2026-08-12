/**
 * Unit tests for Redis-backed payment rate limiters in paymentRoutes.js.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const limiterConfigs = vi.hoisted(() => []);
const mockCreateStore = vi.hoisted(() =>
  vi.fn((prefix) => ({ prefix, type: 'redis-store-stub' })),
);

vi.mock('express-rate-limit', () => ({
  default: vi.fn((config) => {
    limiterConfigs.push(config);
    return (_req, _res, next) => next();
  }),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  createStore: mockCreateStore,
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: () => (_req, _res, next) => next(),
  validateParams: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/idempotency.js', () => ({
  requireIdempotency: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/auditLog.js', () => ({
  auditLog: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/lib/redisLock.js', () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  LockAcquisitionError: class LockAcquisitionError extends Error {},
}));

vi.mock('../../src/core/container.js', () => ({
  orderRepository: {},
  orderValidationService: {},
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: {},
}));

vi.mock('../../src/services/escrow.js', () => ({
  recordDepositTx: vi.fn(),
  getEscrowBookingId: vi.fn(),
  paisaToMaticWei: vi.fn(),
  isEscrowEnabled: vi.fn(() => false),
  escrowLockPayment: vi.fn(),
  resolveExpectedDepositAmount: vi.fn(),
}));

vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification: vi.fn(),
}));

vi.mock('../../src/services/payment/UpiPaymentService.js', () => ({
  default: {},
}));

describe('paymentRoutes rate limiters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limiterConfigs.length = 0;
    vi.resetModules();
  });

  it('wires Redis createStore for lock and status limiters', async () => {
    await import('../../src/routes/paymentRoutes.js');

    expect(mockCreateStore).toHaveBeenCalledWith('rl:payment-lock:');
    expect(mockCreateStore).toHaveBeenCalledWith('rl:payment-status:');

    const stores = limiterConfigs.map((c) => c.store).filter(Boolean);
    expect(stores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ prefix: 'rl:payment-lock:' }),
        expect.objectContaining({ prefix: 'rl:payment-status:' }),
      ]),
    );
  });
});
