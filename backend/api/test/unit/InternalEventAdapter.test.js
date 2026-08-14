import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../../src/middleware/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { InternalEventAdapter } = await import("../../../src/core/events/adapters/InternalEventAdapter.js");

describe("InternalEventAdapter", () => {
  let adapter;

  beforeEach(() => {
    adapter = new InternalEventAdapter();
  });

  describe("constructor", () => {
    it("creates an adapter that is connected by default", () => {
      expect(adapter.isConnected).toBe(true);
    });
  });

  describe("connect", () => {
    it("sets isConnected to true", async () => {
      adapter._connected = false;
      await adapter.connect();
      expect(adapter.isConnected).toBe(true);
    });
  });

  describe("disconnect", () => {
    it("sets isConnected to false and removes all listeners", async () => {
      const handler = vi.fn();
      adapter.on("test.event", handler);
      await adapter.disconnect();
      expect(adapter.isConnected).toBe(false);
    });
  });

  describe("publish", () => {
    it("emits the event locally when connected", async () => {
      const handler = vi.fn();
      adapter.on("order.created", handler);
      const event = { eventType: "order.created", payload: { orderId: "123" } };
      await adapter.publish(event);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it("throws when not connected", async () => {
      adapter._connected = false;
      const event = { eventType: "test" };
      await expect(adapter.publish(event)).rejects.toThrow("Not connected");
    });
  });

  describe("subscribe", () => {
    it("registers a handler for an event type when connected", async () => {
      const handler = vi.fn();
      await adapter.subscribe("user.signup", handler);
      adapter.emit("user.signup", { userId: "1" });
      expect(handler).toHaveBeenCalledWith({ userId: "1" });
    });

    it("throws when not connected", async () => {
      adapter._connected = false;
      await expect(adapter.subscribe("test", vi.fn())).rejects.toThrow("Not connected");
    });
  });

  describe("unsubscribe", () => {
    it("removes a handler", async () => {
      const handler = vi.fn();
      await adapter.subscribe("remove.test", handler);
      await adapter.unsubscribe("remove.test", handler);
      adapter.emit("remove.test", {});
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
