import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock OTel API first
vi.mock("@opentelemetry/api", () => ({
  context: {
    active: vi.fn().mockReturnValue({}),
    with: vi.fn((_ctx, fn) => fn()),
  },
  trace: {
    setSpan: vi.fn((ctx) => ctx),
    getSpan: vi.fn(),
    getActiveSpan: vi.fn(),
  },
  SpanStatusCode: { OK: 0, ERROR: 1, UNSET: 2 },
}));

// Mock logger
vi.mock("../../../src/middleware/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Mock SpanFactory
vi.mock("../../../src/core/telemetry/SpanFactory.js", () => ({
  default: {
    startEventPublishSpan: vi.fn().mockReturnValue({
      setStatus: vi.fn(),
      end: vi.fn(),
      recordException: vi.fn(),
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
    }),
    startEventSubscribeSpan: vi.fn().mockReturnValue({
      setStatus: vi.fn(),
      end: vi.fn(),
      recordException: vi.fn(),
      setAttribute: vi.fn(),
    }),
    recordError: vi.fn(),
  },
  STANDARD_ATTRIBUTES: {},
}));

// Mock ContextPropagator
vi.mock("../../../src/core/telemetry/ContextPropagator.js", () => ({
  ContextPropagator: {
    extractFromEventPayload: vi.fn().mockReturnValue(undefined),
    injectIntoEventPayload: vi.fn((e) => e),
    snapshot: vi.fn().mockReturnValue({}),
    serialize: vi.fn().mockReturnValue({}),
  },
}));

const { EventBus } = await import("../../src/core/events/EventBus.js");
const { EventMetadata, EVENT_CATEGORIES } = await import("../../src/core/events/EventMetadata.js");

describe("EventBus", () => {
  let eventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    eventBus.clearMetrics();
  });

  describe("constructor", () => {
    it("creates an EventBus instance", () => {
      expect(eventBus).toBeDefined();
      expect(eventBus.registry).toBeDefined();
      expect(eventBus.metrics).toEqual({
        published: 0,
        subscribed: 0,
        errors: 0,
        deduplicated: 0,
      });
    });
  });

  describe("publish", () => {
    it("publishes an event by type string", () => {
      const handler = vi.fn();
      eventBus.subscribe("order.created", handler);
      eventBus.publish("order.created", { orderId: "123" });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.any(EventMetadata),
          payload: { orderId: "123" },
        })
      );
    });

    it("publishes an event with BaseEvent-like object", () => {
      const handler = vi.fn();
      eventBus.subscribe("test.event", handler);
      eventBus.publish(
        {
          metadata: new EventMetadata({ eventType: "test.event" }),
          payload: { data: "test" },
        },
        {}
      );
      expect(handler).toHaveBeenCalled();
    });

    it("throws for invalid input", () => {
      expect(() => eventBus.publish(123)).toThrow("requires either a BaseEvent");
      expect(() => eventBus.publish(null)).toThrow("requires either a BaseEvent");
    });

    it("increments published metric", () => {
      const handler = vi.fn();
      eventBus.subscribe("metric.test", handler);
      expect(eventBus.metrics.published).toBe(0);
      eventBus.publish("metric.test", {});
      expect(eventBus.metrics.published).toBe(1);
    });
  });

  describe("subscribe", () => {
    it("registers a handler for an event type", () => {
      const handler = vi.fn();
      eventBus.subscribe("user.signup", handler);
      eventBus.publish("user.signup", { userId: "1" });
      expect(handler).toHaveBeenCalled();
    });

    it("accepts an EventHandler instance", async () => {
      const { EventHandler } = await import("../../src/core/events/EventHandler.js");
      const handlerInstance = new EventHandler(vi.fn().mockResolvedValue("handled"));
      eventBus.subscribe("async.event", handlerInstance);
      await eventBus.publishAsync("async.event", {});
      expect(handlerInstance.handle).toHaveBeenCalled();
    });

    it("throws for non-function handler", () => {
      expect(() => eventBus.subscribe("invalid", "not a function")).toThrow("requires a function");
      expect(() => eventBus.subscribe("invalid", null)).toThrow("requires a function");
      expect(() => eventBus.subscribe("invalid", {})).toThrow("requires a function");
    });

    it("increments subscribed metric", () => {
      expect(eventBus.metrics.subscribed).toBe(0);
      eventBus.subscribe("sub.test", vi.fn());
      expect(eventBus.metrics.subscribed).toBe(1);
    });
  });

  describe("unsubscribe", () => {
    it("removes a handler", () => {
      const handler = vi.fn();
      eventBus.subscribe("remove.test", handler);
      eventBus.unsubscribe("remove.test", handler);
      eventBus.publish("remove.test", {});
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("emitSafe", () => {
    it("calls listeners and returns number of listeners", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      eventBus.on("safe.test", handler1);
      eventBus.on("safe.test", handler2);
      const result = eventBus.emitSafe("safe.test", { data: 1 });
      expect(handler1).toHaveBeenCalledWith({ data: 1 });
      expect(handler2).toHaveBeenCalledWith({ data: 1 });
      expect(result).toBe(2);
    });

    it("handles throwing handlers gracefully", () => {
      const goodHandler = vi.fn();
      const badHandler = vi.fn().mockImplementation(() => {
        throw new Error("handler error");
      });
      eventBus.on("error.test", badHandler);
      eventBus.on("error.test", goodHandler);
      const result = eventBus.emitSafe("error.test", {});
      expect(goodHandler).toHaveBeenCalled();
      expect(eventBus.metrics.errors).toBe(1);
    });

    it("handles async throwing handlers", async () => {
      const handler = vi.fn().mockRejectedValue(new Error("async error"));
      eventBus.on("asyncerror.test", handler);
      const result = eventBus.emitSafe("asyncerror.test", {});
      // emitSafe doesn't wait for promises, so it just checks sync errors
      expect(typeof result).toBe("number");
    });
  });

  describe("adapter registration", () => {
    it("registers an adapter", () => {
      const mockAdapter = {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
      };
      eventBus.registerAdapter("test", mockAdapter);
      expect(eventBus._adapters.has("test")).toBe(true);
    });

    it("removes an adapter", () => {
      const mockAdapter = { connect: vi.fn() };
      eventBus.registerAdapter("toRemove", mockAdapter);
      eventBus.removeAdapter("toRemove");
      expect(eventBus._adapters.has("toRemove")).toBe(false);
    });

    it("connects all adapters", async () => {
      const adapter1 = { connect: vi.fn().mockResolvedValue(undefined) };
      const adapter2 = { connect: vi.fn().mockResolvedValue(undefined) };
      eventBus.registerAdapter("a1", adapter1);
      eventBus.registerAdapter("a2", adapter2);
      await eventBus.connectAdapters();
      expect(adapter1.connect).toHaveBeenCalled();
      expect(adapter2.connect).toHaveBeenCalled();
    });

    it("disconnects all adapters", async () => {
      const adapter = { disconnect: vi.fn().mockResolvedValue(undefined) };
      eventBus.registerAdapter("disc", adapter);
      await eventBus.connectAdapters();
      await eventBus.disconnectAdapters();
      expect(adapter.disconnect).toHaveBeenCalled();
    });
  });

  describe("clearMetrics", () => {
    it("resets all metrics to zero", () => {
      eventBus.publish("m1", {});
      eventBus.subscribe("m2", vi.fn());
      eventBus.clearMetrics();
      expect(eventBus.metrics).toEqual({
        published: 0,
        subscribed: 0,
        errors: 0,
        deduplicated: 0,
      });
    });
  });
});
