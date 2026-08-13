import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendPushNotificationMock = vi.fn();
const loggerWarnMock = vi.fn();
const redisSetMock = vi.fn();
const redisDelMock = vi.fn();
const redisExpireMock = vi.fn();

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
    error: vi.fn(),
    info: vi.fn(),
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
    getActiveSpan: vi.fn(() => ({
      setAttributes: vi.fn(),
    })),
    startWorkerSpan: vi.fn(() => ({
      setAttributes: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
    })),
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

describe('staleOrderWorker notifications', () => {
  let orderRepository;
  let reconcileStaleOrders;

  beforeEach(async () => {
    sendPushNotificationMock.mockReset();
    loggerWarnMock.mockClear();
    redisSetMock.mockReset().mockResolvedValue(true);
    redisDelMock.mockReset().mockResolvedValue(true);
    redisExpireMock.mockReset().mockResolvedValue(true);
    vi.resetModules();
    orderRepository = {
      findStalePendingOrders: vi.fn(),
      cancelStaleOrder: vi.fn(),
      updateLoadOffer: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    ({ reconcileStaleOrders } = await import('../../src/workers/staleOrderWorker.js'));
  });

  function claimRow(id, customerId, displayId) {
    return {
      id,
      customer_id: customerId,
      order_display_id: displayId,
      escrow_status: 'pending',
    };
  }

  it('continues cancelling stale orders when one notification fails', async () => {
    sendPushNotificationMock
      .mockRejectedValueOnce(new Error('push unavailable'))
      .mockResolvedValueOnce();

    orderRepository.findStalePendingOrders.mockResolvedValue({
      data: [{ id: 'order-1' }, { id: 'order-2' }],
      error: null,
    });
    orderRepository.cancelStaleOrder
      .mockResolvedValueOnce({ data: [claimRow('order-1', 'customer-1', 'disp-1')], error: null })
      .mockResolvedValueOnce({ data: [claimRow('order-2', 'customer-2', 'disp-2')], error: null });

    await reconcileStaleOrders(orderRepository);

    expect(orderRepository.updateLoadOffer).toHaveBeenCalledTimes(2);
    expect(sendPushNotificationMock).toHaveBeenCalledTimes(2);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining('failed to notify customer customer-1')
    );
  });

  it('continues cancelling when the load-offer update fails', async () => {
    orderRepository.updateLoadOffer
      .mockRejectedValueOnce(new Error('offer update boom'))
      .mockResolvedValue({ data: null, error: null });

    orderRepository.findStalePendingOrders.mockResolvedValue({
      data: [{ id: 'order-1' }, { id: 'order-2' }],
      error: null,
    });
    orderRepository.cancelStaleOrder
      .mockResolvedValueOnce({ data: [claimRow('order-1', 'customer-1', 'disp-1')], error: null })
      .mockResolvedValueOnce({ data: [claimRow('order-2', 'customer-2', 'disp-2')], error: null });

    await reconcileStaleOrders(orderRepository);

    expect(sendPushNotificationMock).toHaveBeenCalledTimes(2);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining('Failed to cancel load offer for order disp-1')
    );
  });

  it('does not notify when the claim is lost', async () => {
    orderRepository.findStalePendingOrders.mockResolvedValue({
      data: [{ id: 'order-1' }],
      error: null,
    });
    orderRepository.cancelStaleOrder.mockResolvedValue({ data: [], error: null });

    await reconcileStaleOrders(orderRepository);

    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });
});
