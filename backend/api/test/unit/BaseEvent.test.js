import { describe, it, expect } from "vitest";
import { BaseEvent } from "../../src/core/events/BaseEvent.js";

describe("BaseEvent", () => {
  it("rejects non-string eventType", () => {
    expect(() => new BaseEvent({ eventType: 123 })).toThrow("non-empty eventType string");
    expect(() => new BaseEvent({ eventType: "" })).toThrow("non-empty eventType string");
    expect(() => new BaseEvent({})).toThrow("non-empty eventType string");
  });

  it("creates event with valid eventType and defaults", () => {
    const event = new BaseEvent({ eventType: "order.created" });
    expect(event.eventType).toBe("order.created");
    expect(event.payload).toEqual({});
    expect(event.timestamp).toBeDefined();
    expect(event.eventId).toBeDefined();
  });

  it("accepts custom payload", () => {
    const payload = { orderId: "123" };
    const event = new BaseEvent({ eventType: "order.created", payload });
    expect(event.payload).toEqual(payload);
  });

  it("withCorrelationId returns the same instance with updated metadata", () => {
    const event = new BaseEvent({ eventType: "order.created" });
    expect(event.correlationId).toBeNull();
    const updated = event.withCorrelationId("corr-1");
    expect(updated).toBe(event);
    expect(event.correlationId).toBe("corr-1");
  });

  it("withCausationId returns the same instance with updated metadata", () => {
    const event = new BaseEvent({ eventType: "order.created" });
    const updated = event.withCausationId("cause-1");
    expect(updated).toBe(event);
    expect(event.metadata.causationId).toBe("cause-1");
  });

  it("toJSON produces a serializable object", () => {
    const event = new BaseEvent({ eventType: "order.created", payload: { id: 1 } });
    const json = event.toJSON();
    expect(json.metadata).toBeDefined();
    expect(json.payload).toEqual({ id: 1 });
  });
});
