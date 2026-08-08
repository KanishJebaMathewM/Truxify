import { beforeEach, describe, expect, it, vi } from 'vitest';

const processQueueMock = vi.fn();

vi.mock('../../src/services/webhook/dlqService.js', () => ({
  dlqService: { processQueue: processQueueMock },
}));

vi.mock('../../src/services/webhook/escrowWebhookProcessor.js', () => ({
  processEscrowWebhookEvent: vi.fn(),
}));

vi.mock('../../src/core/telemetry/WorkerTracer.js', () => ({
  WorkerTracer: {
    wrapIntervalWorker: vi.fn((_name, handler) => handler),
  },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const { startDlqWorker, stopDlqWorker } = await import('../../src/workers/dlqWorker.js');

describe('dlqWorker lifecycle', () => {
  let intervalCb;
  let clearCb;

  beforeEach(() => {
    vi.clearAllMocks();
    stopDlqWorker();

    intervalCb = null;
    clearCb = null;
    global.setInterval = vi.fn((fn) => {
      intervalCb = fn;
      return { id: 1 };
    });
    global.clearInterval = vi.fn((handle) => {
      clearCb = handle;
    });
  });

  it('starts the polling interval exactly once across repeated starts', () => {
    startDlqWorker();
    startDlqWorker();

    expect(global.setInterval).toHaveBeenCalledTimes(1);
    expect(processQueueMock).not.toHaveBeenCalled();
  });

  it('clears the interval on stop', () => {
    startDlqWorker();
    stopDlqWorker();

    expect(global.clearInterval).toHaveBeenCalled();
    expect(clearCb).toEqual({ id: 1 });
  });

  it('prevents overlapping cycles within the same process', async () => {
    startDlqWorker();

    let release;
    processQueueMock.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const first = intervalCb();
    const second = intervalCb();

    expect(processQueueMock).toHaveBeenCalledTimes(1);

    release();
    await first;
    await second;
  });

  it('continues polling after a failed cycle instead of crashing the process', async () => {
    startDlqWorker();

    processQueueMock.mockRejectedValueOnce(new Error('db down'));

    await expect(intervalCb()).resolves.toBeUndefined();
    expect(processQueueMock).toHaveBeenCalledTimes(1);

    // Next interval runs normally.
    processQueueMock.mockResolvedValueOnce({});
    await intervalCb();
    expect(processQueueMock).toHaveBeenCalledTimes(2);
  });
});
