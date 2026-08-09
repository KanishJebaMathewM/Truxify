import { beforeEach, describe, expect, it, vi } from 'vitest';

const scheduleMock = vi.fn();
const stopMock = vi.fn();

vi.mock('node-cron', () => ({
  default: {
    schedule: scheduleMock,
  },
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: {},
  supabaseAdmin: {},
  redisClient: {},
  supabaseAdmin: null,
}));

vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification: vi.fn(),
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

describe('staleOrderWorker', () => {
  beforeEach(async () => {
    scheduleMock.mockReset();
    scheduleMock.mockReturnValue({ stop: stopMock });

    const { stopStaleOrderWorker } = await import('../../src/workers/staleOrderWorker.js');
    stopStaleOrderWorker();
    stopMock.mockReset();
  });

  it('schedules only one cron task across repeated starts', async () => {
    const { startStaleOrderWorker } = await import('../../src/workers/staleOrderWorker.js');

    const firstTask = startStaleOrderWorker();
    const secondTask = startStaleOrderWorker();

    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(secondTask).toBe(firstTask);
  });

  it('stops the active cron task', async () => {
    const { startStaleOrderWorker, stopStaleOrderWorker } = await import('../../src/workers/staleOrderWorker.js');

    startStaleOrderWorker();
    stopStaleOrderWorker();

    expect(stopMock).toHaveBeenCalledTimes(1);
  });
});
