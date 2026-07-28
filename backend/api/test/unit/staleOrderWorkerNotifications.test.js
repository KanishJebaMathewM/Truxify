import { beforeEach, describe, expect, it, vi } from 'vitest';

let scheduledHandler;
const scheduleMock = vi.fn((expression, handler) => {
  scheduledHandler = handler;
  return { stop: vi.fn() };
});
const sendPushNotificationMock = vi.fn();
const loggerWarnMock = vi.fn();
const updateCalls = [];

vi.mock('node-cron', () => ({
  default: {
    schedule: scheduleMock,
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

function makeBuilder(table) {
  const builder = {
    _mode: 'select',
    _payload: null,
    select() { return this; },
    eq() { return this; },
    lt() { return this; },
    update(payload) {
      this._mode = 'update';
      this._payload = payload;
      return this;
    },
    then(resolve) {
      if (table === 'orders' && this._mode === 'select') {
        return resolve({
          data: [
            { id: 'order-1', customer_id: 'customer-1' },
            { id: 'order-2', customer_id: 'customer-2' },
          ],
          error: null,
        });
      }

      if (table === 'orders' && this._mode === 'update') {
        updateCalls.push(this._payload);
        return resolve({ data: null, error: null });
      }

      return resolve({ data: null, error: null });
    },
  };

  return builder;
}

vi.mock('../../src/config/db.js', () => ({
  supabase: {
    from: vi.fn(makeBuilder),
  },
}));

describe('staleOrderWorker notifications', () => {
  beforeEach(async () => {
    scheduledHandler = null;
    updateCalls.length = 0;
    scheduleMock.mockClear();
    sendPushNotificationMock.mockReset();
    loggerWarnMock.mockClear();
    vi.resetModules();
  });

  it('continues cancelling stale orders when one notification fails', async () => {
    sendPushNotificationMock
      .mockRejectedValueOnce(new Error('push unavailable'))
      .mockResolvedValueOnce();

    const { startStaleOrderWorker } = await import('../../src/workers/staleOrderWorker.js');
    startStaleOrderWorker();

    await scheduledHandler();

    expect(updateCalls).toHaveLength(2);
    expect(sendPushNotificationMock).toHaveBeenCalledTimes(2);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining('failed to notify customer customer-1')
    );
  });
});
