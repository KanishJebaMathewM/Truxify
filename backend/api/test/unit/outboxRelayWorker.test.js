import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const mockOutboxService = vi.hoisted(() => ({
  requeueFailedEvents: vi.fn(),
  fetchPendingEvents: vi.fn(),
  markPublished: vi.fn(),
  markFailed: vi.fn(),
}));

vi.mock('../../src/services/outbox/outboxService.js', () => ({
  outboxService: mockOutboxService,
}));

const mockEventBus = vi.hoisted(() => ({
  publishAndReport: vi.fn().mockResolvedValue({
    published: true,
    deduplicated: false,
    consumed: true,
    adapterAttempted: 1,
    adapterFailures: 0,
    adapterErrors: [],
  }),
}));

vi.mock('../../src/core/events/index.js', () => ({
  eventBus: mockEventBus,
}));

const worker = await import('../../src/workers/outboxRelayWorker.js');

describe('outboxRelayWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    worker.stopOutboxRelayWorker();
  });

  afterEach(() => {
    worker.stopOutboxRelayWorker();
  });

  it('starts and stops the worker without throwing', () => {
    mockOutboxService.fetchPendingEvents.mockResolvedValue([]);
    worker.startOutboxRelayWorker();
    worker.stopOutboxRelayWorker();
    expect(mockLogger.info).toHaveBeenCalled();
  });

  it('publishes pending events and marks them published', async () => {
    mockOutboxService.fetchPendingEvents.mockResolvedValue([
      {
        id: 'evt-1',
        event_type: 'order.created',
        aggregate_id: 'order-1',
        aggregate_type: 'order',
        payload: { a: 1 },
        created_at: '2026-08-11T00:00:00.000Z',
      },
    ]);

    worker.startOutboxRelayWorker();
    await vi.waitFor(() => {
      expect(mockEventBus.publishAndReport).toHaveBeenCalled();
    });

    expect(mockEventBus.publishAndReport).toHaveBeenCalledWith(expect.any(Object), undefined, { adapters: ['kafka'] });
    expect(mockOutboxService.markPublished).toHaveBeenCalledWith('evt-1');
    worker.stopOutboxRelayWorker();
  });

  it('marks an event failed when publish throws', async () => {
    mockOutboxService.fetchPendingEvents.mockResolvedValue([
      {
        id: 'evt-2',
        event_type: 'order.cancelled',
        aggregate_id: 'order-2',
        aggregate_type: 'order',
        payload: {},
        created_at: '2026-08-11T00:00:00.000Z',
      },
    ]);
    mockEventBus.publishAndReport.mockImplementation(() => {
      throw new Error('bus down');
    });

    worker.startOutboxRelayWorker();
    await vi.waitFor(() => {
      expect(mockOutboxService.markFailed).toHaveBeenCalled();
    });

    expect(mockOutboxService.markFailed).toHaveBeenCalledWith('evt-2', expect.stringContaining('bus down'));
    worker.stopOutboxRelayWorker();
  });

  it('does NOT mark an event published when no adapter handled it (regression #11209)', async () => {
    mockOutboxService.fetchPendingEvents.mockResolvedValue([
      {
        id: 'evt-3',
        event_type: 'order.created',
        aggregate_id: 'order-3',
        aggregate_type: 'order',
        payload: { a: 1 },
        created_at: '2026-08-11T00:00:00.000Z',
      },
    ]);
    // Simulate the case where the kafka adapter is not registered / no consumer
    // handled the event: adapterAttempted as 0 and no failures.
    mockEventBus.publishAndReport.mockResolvedValue({
      published: true,
      deduplicated: false,
      consumed: false,
      adapterAttempted: 0,
      adapterFailures: 0,
      adapterErrors: [],
    });

    worker.startOutboxRelayWorker();
    await vi.waitFor(() => {
      expect(mockOutboxService.markFailed).toHaveBeenCalled();
    });

    expect(mockOutboxService.markFailed).toHaveBeenCalledWith('evt-3', expect.stringContaining('No event consumer'));
    expect(mockOutboxService.markPublished).not.toHaveBeenCalledWith('evt-3');
    worker.stopOutboxRelayWorker();
  });
});
