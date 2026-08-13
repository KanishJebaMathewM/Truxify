import { describe, it, expect, vi } from "vitest";
import { EventRegistry } from "../../../src/core/events/EventRegistry.js";

describe("EventRegistry", () => {
  it("rejects non-string eventType in register", () => {
    const reg = new EventRegistry();
    expect(() => reg.register(123)).toThrow("eventType must be a non-empty string");
    expect(() => reg.register("")).toThrow("eventType must be a non-empty string");
  });

  it("register stores the event type", () => {
    const reg = new EventRegistry();
    reg.register("order.created", { source: "api" });
    expect(reg.isValid("order.created")).toBe(true);
    expect(reg.getDefinition("order.created")).toEqual({ source: "api", category: "domain", description: "" });
  });

  it("isValid returns false for unregistered types", () => {
    const reg = new EventRegistry();
    expect(reg.isValid("order.created")).toBe(false);
  });

  it("validate returns valid:true for unregistered types with no validator", () => {
    const reg = new EventRegistry();
    const result = reg.validate("order.created", {});
    expect(result.valid).toBe(true);
  });

  it("validate uses custom validator", () => {
    const reg = new EventRegistry();
    reg.register("order.created", { validator: (payload) => payload.orderId ? true : "missing orderId" });
    expect(reg.validate("order.created", { orderId: "123" }).valid).toBe(true);
    expect(reg.validate("order.created", {}).valid).toBe(false);
  });

  it("validate returns false for unknown event type", () => {
    const reg = new EventRegistry();
    const result = reg.validate("unknown.event", {});
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Unknown event type");
  });

  it("getRegisteredTypes returns all registered type names", () => {
    const reg = new EventRegistry();
    reg.register("order.created");
    reg.register("order.cancelled");
    const types = reg.getRegisteredTypes();
    expect(types).toContain("order.created");
    expect(types).toContain("order.cancelled");
  });

  it("remove deletes the event type and its validator", () => {
    const reg = new EventRegistry();
    reg.register("order.created", { validator: () => true });
    reg.remove("order.created");
    expect(reg.isValid("order.created")).toBe(false);
  });
});
