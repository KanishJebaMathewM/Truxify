import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendPushNotificationMock = vi.fn();
const loggerWarnMock = vi.fn();
const redisSetMock = vi.fn();
const redisDelMock = vi.fn();
const redisExpireMock = vi.fn();
const submitEscrowRefundMock = vi.fn();
const confirmEscrowRefundMock = vi.fn();
const ordersUpdateCalls = [];
let scriptedResponses = [];
const supabaseAdminBuilder = { from: vi.fn(makeBuilder) };
const supabaseBuilder = { from: vi.fn(makeBuilder) };

function makeBuilder(table) {
  const builder = {
    _mode: 'select',
    _payload: null,
    _filters: [],
    select() { return this; },
    eq(column, value) {
      this._filters.push({ op: 'eq', column, value });
      return this;
    },
    lt() { return this; },
    or(filter) {
      this._filters.push({ op: 'or', filter });
      return this;
    },
    in() { return this; },
    maybeSingle() { return this; },
    update(payload) {
      this._mode = 'update';
      this._payload = payload;
      return this;
    },
    then(resolve) {
      const scripted = scriptedResponses.shift();
      const result = scripted ?? { data: null, error: null };
      if (table === 'orders' && this._mode === 'update') {
        ordersUpdateCalls.push({ payload: this._payload, filters: this._filters, result });
      }
      return resolve(result);
    },
  };

  return builder;
}

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn(),
  },
}));

vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification: sendPushNotificationMock,
}));

vi.mock('../../src/services/escrow.js', () => ({
  submitEscrowRefund: vi.fn(),
  confirmEscrowRefund: vi.fn(),
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
    getActiveSpan: vi.fn(() => ({ setAttributes: vi.fn() })),
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
  supabase: supabaseBuilder,
  supabaseAdmin: supabaseAdminBuilder,
}));

describe('staleOrderWorker TOCTOU guard (issue #5741)', () => {
  let orderRepository;
  let reconcileStaleOrders;

  const cancelledRow = (overrides = {}) => ({
    id: 'order-1',
    customer_id: 'customer-1',
    order_display_id: 'disp-1',
    escrow_status: 'pending',
    ...overrides,
  });

  function staleCandidate() {
    return { id: 'order-1' };
  }

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
    submitEscrowRefundMock.mockReset();
    confirmEscrowRefundMock.mockReset();
    supabaseBuilder.from.mockClear();
    supabaseAdminBuilder.from.mockClear();
    vi.resetModules();
    const { startStaleOrderWorker } = await import('../../src/workers/staleOrderWorker.js');
    startStaleOrderWorker();
  });

  const staleOrder = { id: 'order-1', customer_id: 'customer-1', order_display_id: 'disp-1' };

  it('routes orders queries through the service-role client, never the anon client', async () => {
    scriptedResponses = [{ data: [], error: null }];

    await scheduledHandler();

    expect(supabaseAdminBuilder.from).toHaveBeenCalledWith('orders');
    expect(supabaseBuilder.from).not.toHaveBeenCalled();
  });

  function stillPending(overrides = {}) {
    return {
      id: 'order-1',
      customer_id: 'customer-1',
      order_display_id: 'disp-1',
      escrow_status: 'pending',
      escrow_amount_wei: null,
      refund_tx_hash: null,
      escrow_refund_attempts: 0,
      ...overrides,
    };
    ({ reconcileStaleOrders } = await import('../../src/workers/staleOrderWorker.js'));
  });

  it('skips ALL side effects when the CAS claim is lost (order accepted concurrently)', async () => {
    orderRepository.findStalePendingOrders.mockResolvedValue({ data: [staleCandidate()], error: null });
    orderRepository.cancelStaleOrder.mockResolvedValue({ data: [], error: null });

    await reconcileStaleOrders(orderRepository);

    expect(orderRepository.cancelStaleOrder).toHaveBeenCalledTimes(1);
    expect(orderRepository.updateLoadOffer).not.toHaveBeenCalled();
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it('treats a lost CAS race as expected and still processes other orders', async () => {
    orderRepository.findStalePendingOrders.mockResolvedValue({
      data: [{ id: 'order-1' }, { id: 'order-2' }],
      error: null,
    });
    orderRepository.cancelStaleOrder
      .mockResolvedValueOnce({ data: [], error: null })        // order-1: lost race
      .mockResolvedValueOnce({ data: [cancelledRow({ id: 'order-2', customer_id: 'customer-2', order_display_id: 'disp-2' })], error: null });

    await reconcileStaleOrders(orderRepository);

    expect(orderRepository.updateLoadOffer).toHaveBeenCalledTimes(1);
    expect(sendPushNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendPushNotificationMock.mock.calls[0][0]).toBe('customer-2');
  });

  it('never cancels an order whose escrow funding is in flight (RPC no-ops)', async () => {
    orderRepository.findStalePendingOrders.mockResolvedValue({ data: [staleCandidate()], error: null });
    orderRepository.cancelStaleOrder.mockResolvedValue({ data: [], error: null });

    await reconcileStaleOrders(orderRepository);

    expect(orderRepository.cancelStaleOrder).toHaveBeenCalledTimes(1);
    expect(orderRepository.updateLoadOffer).not.toHaveBeenCalled();
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it('cancels a plain pending order and sends exactly one notification', async () => {
    orderRepository.findStalePendingOrders.mockResolvedValue({ data: [staleCandidate()], error: null });
    orderRepository.cancelStaleOrder.mockResolvedValue({ data: [cancelledRow()], error: null });

    await reconcileStaleOrders(orderRepository);

    expect(orderRepository.cancelStaleOrder).toHaveBeenCalledWith(
      'order-1',
      expect.stringContaining('Stale order'),
      expect.any(String),
      {}
    );
    expect(orderRepository.updateLoadOffer).toHaveBeenCalledWith('disp-1', { status: 'cancelled' });
    expect(sendPushNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendPushNotificationMock.mock.calls[0][0]).toBe('customer-1');
    expect(sendPushNotificationMock.mock.calls[0][1]).toBe('Order Cancelled');
  });

  it('routes funded escrow into refund reconciliation WITHOUT submitting the refund itself', async () => {
    orderRepository.findStalePendingOrders.mockResolvedValue({ data: [staleCandidate()], error: null });
    orderRepository.cancelStaleOrder.mockResolvedValue({
      data: [cancelledRow({ escrow_status: 'refund_pending' })],
      error: null,
    });

    await reconcileStaleOrders(orderRepository);

    expect(sendPushNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendPushNotificationMock.mock.calls[0][2]).toContain('escrowed funds are being refunded');
    const { submitEscrowRefund, confirmEscrowRefund } = await import('../../src/services/escrow.js');
    expect(submitEscrowRefund).not.toHaveBeenCalled();
    expect(confirmEscrowRefund).not.toHaveBeenCalled();
  });

  it('records an error and skips side effects when the claim RPC errors', async () => {
    orderRepository.findStalePendingOrders.mockResolvedValue({ data: [staleCandidate()], error: null });
    orderRepository.cancelStaleOrder.mockResolvedValue({ data: null, error: { message: 'rpc boom' } });

    await reconcileStaleOrders(orderRepository);

    expect(orderRepository.updateLoadOffer).not.toHaveBeenCalled();
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });
});
