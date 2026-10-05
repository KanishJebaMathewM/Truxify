import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../../src/middleware/logger.js", () => ({
  default: mockLogger,
}));

const mockOutboxService = vi.hoisted(() => ({
  deadLetterExhaustedEvents: vi.fn(),
  requeueFailedEvents: vi.fn(),
  reclaimExpiredClaims: vi.fn(),
  claimBatch: vi.fn(),
  renewClaim: vi.fn().mockResolvedValue(true),
  markPublished: vi.fn(),
  markFailed: vi.fn(),
}));

vi.mock("../../src/services/outbox/outboxService.js", () => ({
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

vi.mock("../../src/core/events/index.js", () => ({
  eventBus: mockEventBus,
}));

vi.mock("../../src/config/db.js", () => ({ supabase: null, supabaseAdmin: null }));

const worker = await import("../../src/workers/outboxRelayWorker.js");

describe("outboxRelayWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOutboxService.renewClaim.mockResolvedValue(true);
    mockOutboxService.markFailed.mockResolvedValue(true);
    mockEventBus.publishAndReport.mockResolvedValue({
      published: true, deduplicated: false, adapterAttempted: 1,
      adapterFailures: 0, adapterErrors: [],
    });
    worker.stopOutboxRelayWorker();
  });

  afterEach(() => {
    worker.stopOutboxRelayWorker();
  });

  it("starts and stops the worker without throwing", () => {
    mockOutboxService.claimBatch.mockResolvedValue([]);
    worker.startOutboxRelayWorker();
    worker.stopOutboxRelayWorker();
    expect(mockLogger.info).toHaveBeenCalled();
  });

  it("publishes claimed events and marks them published", async () => {
    mockOutboxService.claimBatch.mockResolvedValue([
      {
        attempts: 1,
        event_id: "evt-1",
        event_type: "order.created",
        aggregate_id: "order-1",
        aggregate_type: "order",
        payload: { a: 1 },
        created_at: "2026-08-11T00:00:00.000Z",
      },
    ]);
    mockOutboxService.markPublished.mockResolvedValue(true);

    worker.startOutboxRelayWorker();
    await vi.waitFor(() => {
      expect(mockEventBus.publishAndReport).toHaveBeenCalled();
    });

    expect(mockEventBus.publishAndReport).toHaveBeenCalledWith(
      expect.any(Object),
      undefined,
      { adapters: ["kafka"], deduplicate: false },
    );
    expect(mockOutboxService.markPublished).toHaveBeenCalledWith("evt-1", 1);
    worker.stopOutboxRelayWorker();
  });

  it("marks an event failed when publish throws", async () => {
    mockOutboxService.claimBatch.mockResolvedValue([
      {
        attempts: 1,
        event_id: "evt-2",
        event_type: "order.cancelled",
        aggregate_id: "order-2",
        aggregate_type: "order",
        payload: {},
        created_at: "2026-08-11T00:00:00.000Z",
      },
    ]);
    mockEventBus.publishAndReport.mockImplementation(() => {
      throw new Error("bus down");
    });

    worker.startOutboxRelayWorker();
    await vi.waitFor(() => {
      expect(mockOutboxService.markFailed).toHaveBeenCalled();
    });

    expect(mockOutboxService.markFailed).toHaveBeenCalledWith(
      "evt-2",
      expect.any(String),
      expect.stringContaining("bus down"),
      1,
    );
    worker.stopOutboxRelayWorker();
  });

  it("does NOT mark an event published when no adapter handled it (regression #11209)", async () => {
    mockOutboxService.claimBatch.mockResolvedValue([
      {
        attempts: 1,
        event_id: "evt-3",
        event_type: "order.created",
        aggregate_id: "order-3",
        aggregate_type: "order",
        payload: { a: 1 },
        created_at: "2026-08-11T00:00:00.000Z",
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

    expect(mockOutboxService.markFailed).toHaveBeenCalledWith(
      "evt-3",
      expect.any(String),
      expect.stringContaining("No event consumer"),
      1,
    );
    expect(mockOutboxService.markPublished).not.toHaveBeenCalledWith("evt-3");
    worker.stopOutboxRelayWorker();
  });

  it("does NOT mark an event published when an adapter fails", async () => {
    mockOutboxService.claimBatch.mockResolvedValue([
      {
        attempts: 1,
        event_id: "evt-4",
        event_type: "order.created",
        aggregate_id: "order-4",
        aggregate_type: "order",
        payload: {},
      },
    ]);
    mockEventBus.publishAndReport.mockResolvedValue({
      published: true,
      deduplicated: false,
      consumed: true,
      adapterAttempted: 1,
      adapterFailures: 1,
      adapterErrors: ["kafka: broker unavailable"],
    });

    worker.startOutboxRelayWorker();
    await vi.waitFor(() => {
      expect(mockOutboxService.markFailed).toHaveBeenCalled();
    });

    expect(mockOutboxService.markFailed).toHaveBeenCalledWith(
      "evt-4",
      expect.any(String),
      expect.stringContaining("Adapter failures"),
      1,
    );
    expect(mockOutboxService.markPublished).not.toHaveBeenCalledWith("evt-4");
    worker.stopOutboxRelayWorker();
  });

  it("requires a boolean published success outcome", async () => {
    mockOutboxService.claimBatch.mockResolvedValue([
      {
        attempts: 1,
        event_id: "evt-5",
        event_type: "order.created",
        aggregate_id: "order-5",
        aggregate_type: "order",
        payload: {},
      },
    ]);
    mockEventBus.publishAndReport.mockResolvedValue({
      published: "true",
      deduplicated: false,
      consumed: true,
      adapterAttempted: 1,
      adapterFailures: 0,
      adapterErrors: [],
    });

    worker.startOutboxRelayWorker();
    await vi.waitFor(() => {
      expect(mockOutboxService.markFailed).toHaveBeenCalled();
    });

    expect(mockOutboxService.markPublished).not.toHaveBeenCalledWith("evt-5");
    worker.stopOutboxRelayWorker();
  });
});


describe("outbox relay polling generations", () => {
  let callbacks;
  const settle = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
  beforeEach(async () => {
    worker.stopOutboxRelayWorker();
    await settle();
    vi.clearAllMocks();
    callbacks = [];
    vi.spyOn(globalThis, "setInterval").mockImplementation(callback => {
      callbacks.push(callback);
      return { generation: callbacks.length };
    });
    vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});
    mockOutboxService.deadLetterExhaustedEvents.mockResolvedValue(undefined);
    mockOutboxService.claimBatch.mockResolvedValue([]);
  });
  afterEach(() => {
    worker.stopOutboxRelayWorker();
    vi.restoreAllMocks();
  });
  it("captured stopped callback cannot claim another batch", async () => {
    worker.startOutboxRelayWorker();
    await settle();
    expect(mockOutboxService.claimBatch).toHaveBeenCalledTimes(1);
    worker.stopOutboxRelayWorker();
    await callbacks[0]();
    await settle();
    expect(mockOutboxService.claimBatch).toHaveBeenCalledTimes(1);
  });
  it("captured old callback cannot enter a restarted idle generation", async () => {
    worker.startOutboxRelayWorker();
    await settle();
    worker.stopOutboxRelayWorker();
    worker.startOutboxRelayWorker();
    await settle();
    expect(mockOutboxService.claimBatch).toHaveBeenCalledTimes(2);
    await callbacks[0]();
    await settle();
    expect(mockOutboxService.claimBatch).toHaveBeenCalledTimes(2);
    await callbacks[1]();
    await settle();
    expect(mockOutboxService.claimBatch).toHaveBeenCalledTimes(3);
  });
  it("retains admitted native batch through stop and restart", async () => {
    let release;
    mockOutboxService.claimBatch.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    worker.startOutboxRelayWorker();
    await settle();
    worker.stopOutboxRelayWorker();
    worker.startOutboxRelayWorker();
    await callbacks[1]();
    expect(mockOutboxService.claimBatch).toHaveBeenCalledTimes(1);
    release([]);
    await settle();
    await callbacks[1]();
    await settle();
    expect(mockOutboxService.claimBatch).toHaveBeenCalledTimes(2);
  });
});
