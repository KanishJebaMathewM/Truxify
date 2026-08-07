import { beforeEach, describe, expect, it, vi } from 'vitest';

let scheduledHandler;
const scheduleMock = vi.fn((expression, handler) => {
  scheduledHandler = handler;
  return { stop: vi.fn() };
});
const sendPushNotificationMock = vi.fn();
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
    schedule: scheduleMock,
  },
}));

vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification: sendPushNotificationMock,
}));

vi.mock('../../src/services/escrow.js', () => ({
  submitEscrowRefund: submitEscrowRefundMock,
  confirmEscrowRefund: confirmEscrowRefundMock,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
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
  supabase: supabaseBuilder,
  supabaseAdmin: supabaseAdminBuilder,
}));

describe('staleOrderWorker TOCTOU guard (issue #5741)', () => {
  beforeEach(async () => {
    scheduledHandler = null;
    scriptedResponses = [];
    ordersUpdateCalls.length = 0;
    scheduleMock.mockClear();
    sendPushNotificationMock.mockReset();
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
  }

  it('skips an order that is no longer pending when re-fetched (TOCTOU window closed)', async () => {
    scriptedResponses = [
      { data: [staleOrder], error: null },
      { data: null, error: null }, // re-fetch: not pending anymore
    ];

    await scheduledHandler();

    expect(ordersUpdateCalls).toHaveLength(0);
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it('never cancels an order whose escrow funding is in flight', async () => {
    scriptedResponses = [
      { data: [staleOrder], error: null },
      { data: stillPending({ escrow_status: 'funding' }), error: null },
    ];

    await scheduledHandler();

    expect(ordersUpdateCalls).toHaveLength(0);
    expect(submitEscrowRefundMock).not.toHaveBeenCalled();
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it('guards the plain cancellation update on status=pending AND escrow_status pending/null', async () => {
    scriptedResponses = [
      { data: [staleOrder], error: null },
      { data: stillPending(), error: null },
      { data: [{ id: 'order-1' }], error: null }, // guarded cancel succeeds
    ];

    await scheduledHandler();

    expect(ordersUpdateCalls).toHaveLength(1);
    const { payload, filters } = ordersUpdateCalls[0];
    expect(payload.status).toBe('cancelled');
    expect(filters).toEqual(expect.arrayContaining([
      { op: 'eq', column: 'id', value: 'order-1' },
      { op: 'eq', column: 'status', value: 'pending' },
      { op: 'or', filter: 'escrow_status.is.null,escrow_status.eq.pending' },
    ]));
    expect(sendPushNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('routes funded escrow through submitEscrowRefund before finalising the cancellation', async () => {
    submitEscrowRefundMock.mockResolvedValue({
      txHash: '0xrefund',
      bookingId: '0xbooking',
      waitForConfirmation: async () => ({ hash: '0xrefund' }),
    });

    scriptedResponses = [
      { data: [staleOrder], error: null },
      { data: stillPending({ escrow_status: 'funded' }), error: null },
      { data: [{ id: 'order-1' }], error: null }, // → refund_pending
      { data: [{ id: 'order-1' }], error: null }, // → refunded
    ];

    await scheduledHandler();

    expect(submitEscrowRefundMock).toHaveBeenCalledWith('disp-1');

    const refundPending = ordersUpdateCalls.find(c => c.payload.escrow_status === 'refund_pending');
    expect(refundPending).toBeDefined();
    expect(refundPending.filters).toEqual(expect.arrayContaining([
      { op: 'eq', column: 'status', value: 'pending' },
      { op: 'eq', column: 'escrow_status', value: 'funded' },
    ]));

    const refunded = ordersUpdateCalls.find(c => c.payload.escrow_status === 'refunded');
    expect(refunded).toBeDefined();
    expect(refunded.payload.refund_tx_hash).toBe('0xrefund');
    expect(sendPushNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('leaves the order for refund reconciliation when the refund submit fails', async () => {
    submitEscrowRefundMock.mockRejectedValue(new Error('cancelBooking reverted'));

    scriptedResponses = [
      { data: [staleOrder], error: null },
      { data: stillPending({ escrow_status: 'funded' }), error: null },
      { data: [{ id: 'order-1' }], error: null }, // → refund_pending
    ];

    await scheduledHandler();

    const failed = ordersUpdateCalls.find(c => c.payload.escrow_status === 'refund_failed');
    expect(failed).toBeDefined();
    expect(failed.payload.escrow_refund_error).toContain('cancelBooking reverted');
    expect(sendPushNotificationMock).toHaveBeenCalledTimes(1);
  });
});
