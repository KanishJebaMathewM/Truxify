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
  it('ignores a captured interval callback after stop', async () => {
    processQueueMock.mockResolvedValue({});
    startDlqWorker();
    const stale = intervalCb;
    stopDlqWorker();
    await stale();
    expect(processQueueMock).not.toHaveBeenCalled();
  });

  it('retains native cycle admission through stop and restart', async () => {
    let release;
    processQueueMock.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    processQueueMock.mockResolvedValue({});
    startDlqWorker();
    const stale = intervalCb;
    const pending = stale();
    stopDlqWorker();
    startDlqWorker();
    const fresh = intervalCb;
    try {
      await fresh();
      expect(processQueueMock).toHaveBeenCalledTimes(1);
      await stale();
      expect(processQueueMock).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await pending;
    }
    await fresh();
    expect(processQueueMock).toHaveBeenCalledTimes(2);
  });

  it('old stopped callbacks cannot enter a newer idle worker generation', async () => {
    processQueueMock.mockResolvedValue({});
    startDlqWorker();
    const stale = intervalCb;
    stopDlqWorker();
    startDlqWorker();
    const fresh = intervalCb;
    await stale();
    expect(processQueueMock).not.toHaveBeenCalled();
    await fresh();
    expect(processQueueMock).toHaveBeenCalledTimes(1);
  });

  it('failed native cycle releases admission after restart', async () => {
    let reject;
    processQueueMock.mockReturnValueOnce(new Promise((resolve, fail) => { reject = fail; }));
    processQueueMock.mockResolvedValue({});
    startDlqWorker();
    const pending = intervalCb();
    stopDlqWorker();
    startDlqWorker();
    const fresh = intervalCb;
    await fresh();
    expect(processQueueMock).toHaveBeenCalledTimes(1);
    reject(new Error('late failure'));
    await pending;
    await fresh();
    expect(processQueueMock).toHaveBeenCalledTimes(2);
  });

});
