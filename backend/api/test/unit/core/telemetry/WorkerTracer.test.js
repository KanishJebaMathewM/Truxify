import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSpan = {
  recordException: vi.fn(),
  setStatus: vi.fn(),
  setAttributes: vi.fn(),
  addEvent: vi.fn(),
  end: vi.fn(),
  spanContext: () => ({ traceId: 'trace-1' }),
};

vi.mock('../../../../src/core/telemetry/SpanFactory.js', () => ({
  default: {
    startWorkerSpan: vi.fn(() => mockSpan),
    startRetrySpan: vi.fn(() => mockSpan),
    recordError: vi.fn(),
    withWorkerSpan: vi.fn(async (name, fn, options) => fn()),
  },
  STANDARD_ATTRIBUTES: {
    WORKER_ATTEMPT: 'worker.attempt',
    WORKER_MAX_ATTEMPTS: 'worker.max_attempts',
  },
}));

vi.mock('../../../../src/core/telemetry/ContextPropagator.js', () => ({
  ContextPropagator: {
    snapshot: vi.fn(() => ({})),
  },
}));

const { WorkerTracer } = await import('../../../../src/core/telemetry/WorkerTracer.js');
const spanFactoryMock = (await import('../../../../src/core/telemetry/SpanFactory.js')).default;

describe('WorkerTracer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createTracedWorker runs the handler and ends the span on success', async () => {
    const handler = vi.fn().mockResolvedValue('done');
    const traced = WorkerTracer.createTracedWorker('my-worker', handler);

    const result = await traced('arg1');

    expect(result).toBe('done');
    expect(spanFactoryMock.startWorkerSpan).toHaveBeenCalledWith(
      'my-worker',
      expect.objectContaining({
        attributes: expect.objectContaining({ 'worker.attempt': 1, 'worker.max_attempts': 1 }),
      }),
    );
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('createTracedWorker retries and throws after exhausting attempts', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('flaky'));
    const traced = WorkerTracer.createTracedWorker('my-worker', handler, {
      maxAttempts: 2,
      retryDelayMs: 1,
    });

    await expect(traced()).rejects.toThrow('flaky');
    expect(handler).toHaveBeenCalledTimes(2);
    expect(spanFactoryMock.startRetrySpan).toHaveBeenCalled();
  });

  it('wrapCronJob wraps with a worker span', async () => {
    const cronHandler = vi.fn().mockResolvedValue('cron-ok');
    const wrapped = WorkerTracer.wrapCronJob('nightly', cronHandler, { schedule: '0 3 * * *' });

    const result = await wrapped();
    expect(result).toBe('cron-ok');
    expect(spanFactoryMock.withWorkerSpan).toHaveBeenCalled();
  });

  it('wrapIntervalWorker wraps with a worker span', async () => {
    const handler = vi.fn().mockResolvedValue('tick');
    const wrapped = WorkerTracer.wrapIntervalWorker('sweeper', handler, { intervalMs: 60000 });

    expect(await wrapped()).toBe('tick');
    expect(spanFactoryMock.withWorkerSpan).toHaveBeenCalledWith(
      'sweeper',
      expect.any(Function),
      expect.objectContaining({
        attributes: expect.objectContaining({ 'worker.interval_ms': 60000 }),
      }),
    );
  });

  it('wrapChildProcess wraps with a worker span', async () => {
    const handler = vi.fn().mockResolvedValue('spawned');
    const wrapped = WorkerTracer.wrapChildProcess('worker-pool', handler);

    expect(await wrapped(1)).toBe('spawned');
    expect(spanFactoryMock.withWorkerSpan).toHaveBeenCalled();
  });
});
