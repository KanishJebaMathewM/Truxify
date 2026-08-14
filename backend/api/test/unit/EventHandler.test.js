import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSpan = {
  setStatus: vi.fn(),
  end: vi.fn(),
  recordError: vi.fn(),
  setAttribute: vi.fn(),
  setAttributes: vi.fn(),
};

vi.mock("../../../src/core/telemetry/SpanFactory.js", () => ({
  default: {
    startEventHandlerSpan: vi.fn().mockReturnValue(mockSpan),
  },
}));

vi.mock("../../../src/core/telemetry/ContextPropagator.js", () => ({
  ContextPropagator: { extractFromEventPayload: vi.fn() },
}));

vi.mock("../../../src/middleware/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Mock OTel API at the module level
vi.mock("@opentelemetry/api", () => ({
  context: Object.assign(
    vi.fn(() => ({})),
    {
      active: vi.fn(() => ({})),
      with: vi.fn((_ctx, fn) => fn()),
    }
  ),
  trace: Object.assign(vi.fn(), {
    setSpan: vi.fn(),
    getSpan: vi.fn(),
    getActiveSpan: vi.fn(),
  }),
  SpanStatusCode: { OK: 0, ERROR: 1, UNSET: 2 },
}));

const { EventHandler } = await import("../../src/core/events/EventHandler.js");

describe("EventHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects non-function handler", () => {
    expect(() => new EventHandler("not a function")).toThrow("requires a function handler");
    expect(() => new EventHandler(123)).toThrow("requires a function handler");
  });

  it("calls the handler with the event", async () => {
    const handler = vi.fn().mockResolvedValue("result");
    const h = new EventHandler(handler);
    await h.handle({ type: "order.created" });
    expect(handler).toHaveBeenCalledWith({ type: "order.created" });
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it("respects timeout option", async () => {
    const handler = vi.fn().mockReturnValue(new Promise(() => {}));
    const h = new EventHandler(handler, { timeout: 50 });
    await expect(h.handle({})).rejects.toThrow(/timed out/);
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it("calls onError when handler throws and onError is provided", async () => {
    const onError = vi.fn().mockReturnValue("fallback");
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const h = new EventHandler(handler, { onError });
    const result = await h.handle({});
    expect(onError).toHaveBeenCalled();
    expect(result).toBe("fallback");
  });

  it("re-throws when handler throws and no onError is provided", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const h = new EventHandler(handler);
    await expect(h.handle({})).rejects.toThrow("boom");
  });

  it("EventHandler.wrap creates an instance", () => {
    const fn = vi.fn();
    const h = EventHandler.wrap(fn);
    expect(h).toBeInstanceOf(EventHandler);
  });
});
