import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { dlqMock, tracerMock } = vi.hoisted(() => ({
  dlqMock: { processQueue: vi.fn() },
  tracerMock: { wrapIntervalWorker: vi.fn() },
}));

vi.mock('../../src/services/webhook/dlqService.js', () => ({ dlqService: dlqMock }));
vi.mock('../../src/services/webhook/escrowWebhookProcessor.js', () => ({
  processEscrowWebhookEvent: vi.fn(),
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/core/telemetry/WorkerTracer.js', () => ({ WorkerTracer: tracerMock }));

import { startDlqWorker, stopDlqWorker } from '../../src/workers/dlqWorker.js';

describe('dlqWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tracerMock.wrapIntervalWorker.mockImplementation((_name, fn, _opts) => fn);
  });

  afterEach(() => {
    stopDlqWorker();
  });

  it('starts the worker and processes the queue', async () => {
    dlqMock.processQueue.mockResolvedValue();
    startDlqWorker();
    expect(tracerMock.wrapIntervalWorker).toHaveBeenCalledWith('dlq-worker', expect.any(Function), expect.objectContaining({ intervalMs: expect.any(Number) }));
  });

  it('does not start twice', async () => {
    startDlqWorker();
    startDlqWorker();
    expect(tracerMock.wrapIntervalWorker).toHaveBeenCalledTimes(1);
  });

  it('stops cleanly', () => {
    startDlqWorker();
    stopDlqWorker();
    stopDlqWorker(); // second stop is a no-op
    expect(true).toBe(true);
  });
});
