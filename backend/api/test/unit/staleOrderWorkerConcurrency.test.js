import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendPushNotificationMock = vi.fn();
const loggerErrorMock = vi.fn();
const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();
const redisSetMock = vi.fn();
const redisDelMock = vi.fn();
const redisExpireMock = vi.fn();
const spanSetAttributesMock = vi.fn();

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
  redisClient: {
    set: redisSetMock,
    del: redisDelMock,
    expire: redisExpireMock,
  },
}));

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
    redisSetMock.mockReset().mockResolvedValue(true);
    redisDelMock.mockReset().mockResolvedValue(true);
    redisExpireMock.mockReset().mockResolvedValue(true);
    vi.resetModules();
    orderRepository = buildRepository();
    ({ reconcileStaleOrders } = await import('../../src/workers/staleOrderWorker.js'));
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

  it('skips the whole batch when another replica holds the Redis lock', async () => {
    redisSetMock.mockResolvedValue(false);

    orderRepository.findStalePendingOrders.mockResolvedValue({ data: [{ id: 'order-1' }], error: null });

    await reconcileStaleOrders(orderRepository);

    expect(orderRepository.findStalePendingOrders).not.toHaveBeenCalled();
    expect(loggerInfoMock).toHaveBeenCalledWith(expect.stringContaining('held by another replica'));
    expect(redisDelMock).not.toHaveBeenCalled();
  });

  it('skips the batch when the Redis lock acquisition fails (fail closed)', async () => {
    redisSetMock.mockRejectedValue(new Error('redis down'));

    await reconcileStaleOrders(orderRepository);

    expect(orderRepository.findStalePendingOrders).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('Failed to acquire Redis global lock'),
      'redis down'
    );
  });

  it('releases the global lock after the sweep', async () => {
    orderRepository.findStalePendingOrders.mockResolvedValue({ data: [], error: null });

    await reconcileStaleOrders(orderRepository);

    expect(redisDelMock).toHaveBeenCalledWith('stale:order:cancellation:lock');
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

  it('does not double-run when the in-memory re-entrancy guard is set', async () => {
    orderRepository.findStalePendingOrders.mockResolvedValue({ data: [], error: null });

    const { reconcileStaleOrders: firstCall } = await import('../../src/workers/staleOrderWorker.js');

    let releaseInFlight;
    const gate = new Promise((resolve) => { releaseInFlight = resolve; });
    redisDelMock.mockImplementation(() => {
      releaseInFlight();
      return Promise.resolve(true);
    });

    const p1 = firstCall(orderRepository);
    await gate;
    const p2 = firstCall(orderRepository);
    await Promise.all([p1, p2]);

    expect(orderRepository.findStalePendingOrders).toHaveBeenCalledTimes(1);
  });
});
