import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
}));

vi.mock('../src/lib/redisLock.js', () => ({
  acquireLock: mocks.acquireLock,
  releaseLock: mocks.releaseLock,
}));

vi.mock('../src/config/db.js', () => ({
  get supabase() { return null; },
  get supabaseAdmin() { return null; },
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

vi.mock('../src/core/events/index.js', () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(), once: vi.fn() },
  EventBus: class {},
}));

vi.mock('../src/services/escrow.js', () => ({
  escrowRelease: vi.fn(),
  escrowRefund: vi.fn(),
  recordDepositTx: vi.fn(),
  submitEscrowRefund: vi.fn(),
  submitEscrowCancelWithPenalty: vi.fn(),
  confirmEscrowRefund: vi.fn(),
  getEscrowBookingId: vi.fn(),
}));

const { OrderLifecycleService } = await import(
  '../src/services/order/orderLifecycleService.js'
);

function makeService({ verifyDelivery } = {}) {
  const deliveryVerification = {
    verifyDelivery:
      verifyDelivery ||
      vi.fn().mockResolvedValue({ escrowUpdateFailed: false }),
  };
  return new OrderLifecycleService({
    orderRepository: {},
    deliveryVerificationService: deliveryVerification,
  });
}

describe('OrderLifecycleService.verifyDeliveryFn (issue #2082)', () => {
  beforeEach(() => {
    mocks.acquireLock.mockReset();
    mocks.releaseLock.mockReset();
  });

  it('acquires the per-order escrow lock with a long TTL before releasing payment', async () => {
    mocks.acquireLock.mockResolvedValue('lock-owner-1');
    mocks.releaseLock.mockResolvedValue(true);
    const svc = makeService();

    await svc.verifyDeliveryFn('order-1', 'driver-1', '123456', {});

    expect(mocks.acquireLock).toHaveBeenCalledWith('escrow_lock:order-1', 120000);
    expect(mocks.releaseLock).toHaveBeenCalledWith('escrow_lock:order-1', 'lock-owner-1');
  });

  it('serializes concurrent requests by rejecting when the lock is already held', async () => {
    mocks.acquireLock.mockResolvedValue(null);
    const svc = makeService();

    await expect(
      svc.verifyDeliveryFn('order-1', 'driver-1', '123456', {}),
    ).rejects.toMatchObject({
      status: 409,
      payload: { error: expect.stringContaining('currently being processed') },
    });

    // A rejected request must not run the blockchain release or release a
    // lock it never owned.
    expect(svc.deliveryVerification.verifyDelivery).not.toHaveBeenCalled();
    expect(mocks.releaseLock).not.toHaveBeenCalled();
  });

  it('releases the lock in a finally block when delivery verification throws', async () => {
    mocks.acquireLock.mockResolvedValue('lock-owner-1');
    mocks.releaseLock.mockResolvedValue(true);
    const boom = vi.fn().mockRejectedValue(new Error('on-chain timeout'));
    const svc = makeService({ verifyDelivery: boom });

    await expect(
      svc.verifyDeliveryFn('order-1', 'driver-1', '123456', {}),
    ).rejects.toThrow('on-chain timeout');

    expect(mocks.releaseLock).toHaveBeenCalledWith('escrow_lock:order-1', 'lock-owner-1');
  });
});
