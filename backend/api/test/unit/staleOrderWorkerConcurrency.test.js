import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendPushNotificationMock = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());
const loggerInfoMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());
const spanSetAttributesMock = vi.hoisted(() => vi.fn());
const acquireLockMock = vi.hoisted(() => vi.fn());
const renewLockMock = vi.hoisted(() => vi.fn());
const releaseLockMock = vi.hoisted(() => vi.fn());

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn(),
  },
}));

vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification: sendPushNotificationMock,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: loggerErrorMock,
    info: loggerInfoMock,
    warn: loggerWarnMock,
  },
}));

vi.mock('../../src/core/telemetry/WorkerTracer.js', () => ({
  WorkerTracer: {
    wrapCronJob: vi.fn((_name, handler) => handler),
    wrapIntervalWorker: vi.fn((_name, handler) => handler),
  },
}));

vi.mock('../../src/core/telemetry/SpanFactory.js', () => ({
  default: {
    getActiveSpan: vi.fn(() => ({ setAttributes: spanSetAttributesMock })),
    startWorkerSpan: vi.fn(() => ({ setAttributes: vi.fn(), setStatus: vi.fn(), end: vi.fn() })),
  },
  STANDARD_ATTRIBUTES: {},
  SPAN_NAMES: {},
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: {},
  supabaseAdmin: {},
}));

// The worker must go through the owner-aware redisLock abstraction — never
// touch Redis directly. Mock it so each lock operation can be driven to
// success/failure and ownership semantics are asserted at the worker level.
vi.mock('../../src/lib/redisLock.js', () => ({
  acquireLock: acquireLockMock,
  renewLock: renewLockMock,
  releaseLock: releaseLockMock,
  LockAcquisitionError: class LockAcquisitionError extends Error {},
}));

const LOCK_KEY = 'stale:order:cancellation:lock';
const LOCK_TTL_MS = 120_000;

function buildRepository() {
  return {
    findStalePendingOrders: vi.fn(),
    cancelStaleOrder: vi.fn(),
    updateLoadOffer: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const claimRow = (id, customerId, displayId, escrowStatus = 'pending') => ({
  id,
  customer_id: customerId,
  order_display_id: displayId,
  escrow_status: escrowStatus,
});

describe('staleOrderWorker cross-replica concurrency', () => {
  let orderRepository;
  let reconcileStaleOrders;

  beforeEach(async () => {
    sendPushNotificationMock.mockReset();
    loggerErrorMock.mockClear();
    loggerInfoMock.mockClear();
    loggerWarnMock.mockClear();
    spanSetAttributesMock.mockReset();
    acquireLockMock.mockReset().mockResolvedValue('lock-token');
    renewLockMock.mockReset().mockResolvedValue(true);
    releaseLockMock.mockReset().mockResolvedValue(true);
    vi.resetModules();
    orderRepository = buildRepository();
    ({ reconcileStaleOrders } = await import('../../src/workers/staleOrderWorker.js'));
  });

  it('runs the sweep only when the owner-aware lock is acquired', async () => {
    orderRepository.findStalePendingOrders.mockResolvedValue({ data: [], error: null });

    await reconcileStaleOrders(orderRepository);

    expect(acquireLockMock).toHaveBeenCalledWith(LOCK_KEY, LOCK_TTL_MS);
    expect(orderRepository.findStalePendingOrders).toHaveBeenCalled();
    expect(releaseLockMock).toHaveBeenCalledWith(LOCK_KEY, 'lock-token');
  });

  it('skips the whole batch when another replica holds the Redis lock', async () => {
    acquireLockMock.mockResolvedValue(null);

    orderRepository.findStalePendingOrders.mockResolvedValue({ data: [{ id: 'order-1' }], error: null });

    await reconcileStaleOrders(orderRepository);

    expect(orderRepository.findStalePendingOrders).not.toHaveBeenCalled();
    expect(loggerInfoMock).toHaveBeenCalledWith(expect.stringContaining('held by another replica'));
    expect(releaseLockMock).not.toHaveBeenCalled();
  });

  it('skips the batch when the Redis lock acquisition fails (fail closed)', async () => {
    const { LockAcquisitionError } = await import('../../src/lib/redisLock.js');
    acquireLockMock.mockRejectedValue(new LockAcquisitionError(LOCK_KEY, 'redis down'));

    await reconcileStaleOrders(orderRepository);

    expect(orderRepository.findStalePendingOrders).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('Redis unavailable while acquiring global lock')
    );
  });

  it('does not crash when acquireLock throws an unexpected non-lock error', async () => {
    acquireLockMock.mockRejectedValue(new Error('boom'));

    await reconcileStaleOrders(orderRepository);

    expect(orderRepository.findStalePendingOrders).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('Failed to acquire Redis global lock')
    );
  });

  it('renews the lock with the owner token before each order', async () => {
    orderRepository.findStalePendingOrders.mockResolvedValue({
      data: [{ id: 'order-1' }, { id: 'order-2' }],
      error: null,
    });
    orderRepository.cancelStaleOrder
      .mockResolvedValueOnce({ data: [claimRow('order-1', 'customer-1', 'disp-1')], error: null })
      .mockResolvedValueOnce({ data: [claimRow('order-2', 'customer-2', 'disp-2')], error: null });

    await reconcileStaleOrders(orderRepository);

    expect(renewLockMock).toHaveBeenCalledWith(LOCK_KEY, 'lock-token', LOCK_TTL_MS);
    expect(orderRepository.cancelStaleOrder).toHaveBeenCalledTimes(2);
  });

  it('stops sweeping when ownership is lost (renewal fails)', async () => {
    orderRepository.findStalePendingOrders.mockResolvedValue({
      data: [{ id: 'order-1' }, { id: 'order-2' }, { id: 'order-3' }],
      error: null,
    });
    orderRepository.cancelStaleOrder.mockResolvedValue({
      data: [claimRow('order-1', 'customer-1', 'disp-1')],
      error: null,
    });
    // First renewal succeeds, the next one fails — the lock was stolen.
    renewLockMock
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);

    await reconcileStaleOrders(orderRepository);

    // Only the first order was processed before ownership was lost.
    expect(orderRepository.cancelStaleOrder).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(expect.stringContaining('Lost ownership'));
    // The owner-checked release still runs in `finally` and is a safe no-op.
    expect(releaseLockMock).toHaveBeenCalledWith(LOCK_KEY, 'lock-token');
  });

  it('stops safely when Redis is unavailable during renewal', async () => {
    orderRepository.findStalePendingOrders.mockResolvedValue({
      data: [{ id: 'order-1' }, { id: 'order-2' }],
      error: null,
    });
    orderRepository.cancelStaleOrder.mockResolvedValue({
      data: [claimRow('order-1', 'customer-1', 'disp-1')],
      error: null,
    });
    // renewLock swallows Redis errors and reports "not renewed" (false).
    renewLockMock.mockResolvedValueOnce(true).mockResolvedValue(false);

    await expect(reconcileStaleOrders(orderRepository)).resolves.toBeUndefined();

    expect(orderRepository.cancelStaleOrder).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(expect.stringContaining('Lost ownership'));
  });

  it('handles a release failure without crashing the worker', async () => {
    orderRepository.findStalePendingOrders.mockResolvedValue({ data: [], error: null });
    releaseLockMock.mockResolvedValue(false);

    await expect(reconcileStaleOrders(orderRepository)).resolves.toBeUndefined();

    expect(releaseLockMock).toHaveBeenCalledWith(LOCK_KEY, 'lock-token');
    expect(loggerWarnMock).toHaveBeenCalledWith(expect.stringContaining('Failed to release global lock'));
  });

  it('releases the global lock after the sweep', async () => {
    orderRepository.findStalePendingOrders.mockResolvedValue({ data: [], error: null });

    await reconcileStaleOrders(orderRepository);

    expect(releaseLockMock).toHaveBeenCalledWith(LOCK_KEY, 'lock-token');
  });

  it('sweeps in bounded batches (env-configurable batch size)', async () => {
    const originalBatchSize = process.env.STALE_ORDER_WORKER_BATCH_SIZE;
    process.env.STALE_ORDER_WORKER_BATCH_SIZE = '7';

    orderRepository.findStalePendingOrders.mockResolvedValue({ data: [], error: null });

    await reconcileStaleOrders(orderRepository);

    expect(orderRepository.findStalePendingOrders).toHaveBeenCalledWith(expect.any(String), 7);

    if (originalBatchSize === undefined) {
      delete process.env.STALE_ORDER_WORKER_BATCH_SIZE;
    } else {
      process.env.STALE_ORDER_WORKER_BATCH_SIZE = originalBatchSize;
    }
  });

  it('reports cancellation metrics on the active span', async () => {
    orderRepository.findStalePendingOrders.mockResolvedValue({
      data: [{ id: 'order-1' }, { id: 'order-2' }],
      error: null,
    });
    orderRepository.cancelStaleOrder
      .mockResolvedValueOnce({ data: [claimRow('order-1', 'customer-1', 'disp-1')], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    await reconcileStaleOrders(orderRepository);

    expect(spanSetAttributesMock).toHaveBeenCalledWith(expect.objectContaining({
      'stale_orders.found': 2,
      'stale_orders.cancelled': 1,
      'stale_orders.skipped': 1,
      'stale_orders.errors': 0,
    }));
  });

  it('two replicas: only one owner executes the protected sweep', async () => {
    vi.resetModules();
    const { reconcileStaleOrders: replicaA } = await import('../../src/workers/staleOrderWorker.js');
    vi.resetModules();
    const { reconcileStaleOrders: replicaB } = await import('../../src/workers/staleOrderWorker.js');

    // The shared mock models a real contended lock: replica A wins the
    // acquisition, replica B loses it (the key is now held).
    acquireLockMock
      .mockResolvedValueOnce('token-A')
      .mockResolvedValueOnce(null);

    orderRepository.findStalePendingOrders.mockResolvedValue({
      data: [{ id: 'order-1' }],
      error: null,
    });

    await Promise.all([replicaA(orderRepository), replicaB(orderRepository)]);

    expect(orderRepository.findStalePendingOrders).toHaveBeenCalledTimes(1);
    expect(orderRepository.cancelStaleOrder).toHaveBeenCalledTimes(1);
    expect(loggerInfoMock).toHaveBeenCalledWith(expect.stringContaining('held by another replica'));
  });

  it('two replicas racing the same order produce exactly ONE cancellation + ONE notification', async () => {
    vi.resetModules();
    const { reconcileStaleOrders: replicaA } = await import('../../src/workers/staleOrderWorker.js');
    vi.resetModules();
    const { reconcileStaleOrders: replicaB } = await import('../../src/workers/staleOrderWorker.js');

    orderRepository.findStalePendingOrders.mockResolvedValue({ data: [{ id: 'order-1' }], error: null });
    orderRepository.cancelStaleOrder
      .mockResolvedValueOnce({ data: [claimRow('order-1', 'customer-1', 'disp-1')], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    await Promise.all([replicaA(orderRepository), replicaB(orderRepository)]);

    expect(orderRepository.cancelStaleOrder).toHaveBeenCalledTimes(2);
    expect(orderRepository.updateLoadOffer).toHaveBeenCalledTimes(1);
    expect(sendPushNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('does not double-run when the in-memory re-entrancy guard is set', async () => {
    let releaseFetch;
    const fetchGate = new Promise((resolve) => { releaseFetch = resolve; });
    orderRepository.findStalePendingOrders.mockImplementation(() =>
      fetchGate.then(() => ({ data: [], error: null }))
    );

    const p1 = reconcileStaleOrders(orderRepository);
    await Promise.resolve(); // let p1 reach the gated fetch
    const p2 = reconcileStaleOrders(orderRepository);
    releaseFetch();
    await Promise.all([p1, p2]);

    expect(orderRepository.findStalePendingOrders).toHaveBeenCalledTimes(1);
  });
});
