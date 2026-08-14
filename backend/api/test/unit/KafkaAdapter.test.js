import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../../src/middleware/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Mock ContextPropagator
vi.mock("../../../src/core/telemetry/ContextPropagator.js", () => ({
  ContextPropagator: {
    injectIntoEventPayload: vi.fn((e) => e),
  },
}));

// Mock EventPublisher base class
vi.mock("../../../src/core/events/EventPublisher.js", () => ({
  EventPublisher: class EventPublisher {
    constructor() {}
  },
}));

const { KafkaAdapter } = await import("../../../src/core/events/adapters/KafkaAdapter.js");

describe("KafkaAdapter", () => {
  let mockKafkaConfig;
  let adapter;

  beforeEach(() => {
    mockKafkaConfig = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      publishEvent: vi.fn().mockResolvedValue(undefined),
      publishBatch: vi.fn().mockResolvedValue(undefined),
    };
    adapter = new KafkaAdapter(mockKafkaConfig);
  });

  describe("constructor", () => {
    it("creates an adapter with unconnected state", () => {
      expect(adapter.isConnected).toBe(false);
      expect(adapter._kafkaConfig).toBe(mockKafkaConfig);
    });
  });

  describe("connect", () => {
    it("calls kafkaConfig.connect and sets connected to true", async () => {
      await adapter.connect();
      expect(mockKafkaConfig.connect).toHaveBeenCalled();
      expect(adapter.isConnected).toBe(true);
    });

    it("does nothing if already connected", async () => {
      await adapter.connect();
      await adapter.connect();
      expect(mockKafkaConfig.connect).toHaveBeenCalledTimes(1);
    });

    it("throws if kafkaConfig.connect fails", async () => {
      mockKafkaConfig.connect.mockRejectedValueOnce(new Error("Connection failed"));
      await expect(adapter.connect()).rejects.toThrow("Connection failed");
    });
  });

  describe("disconnect", () => {
    it("calls kafkaConfig.disconnect and sets connected to false", async () => {
      await adapter.connect();
      await adapter.disconnect();
      expect(mockKafkaConfig.disconnect).toHaveBeenCalled();
      expect(adapter.isConnected).toBe(false);
    });

    it("does nothing if not connected", async () => {
      await adapter.disconnect();
      expect(mockKafkaConfig.disconnect).not.toHaveBeenCalled();
    });
  });

  describe("setTopicMap", () => {
    it("sets topic mappings", () => {
      adapter.setTopicMap({ "order.created": "orders-topic" });
      expect(adapter.getTopic("order.created")).toBe("orders-topic");
    });

    it("falls back to eventType with dots replaced by underscores", () => {
      adapter.setTopicMap({});
      expect(adapter.getTopic("order.created")).toBe("order_created");
    });
  });

  describe("publish", () => {
    it("publishes an event to the correct topic", async () => {
      adapter.setTopicMap({ "order.created": "orders-topic" });
      const event = {
        eventType: "order.created",
        metadata: { eventId: "event-123" },
        payload: { orderId: "123" },
      };
      await adapter.publish(event);
      expect(mockKafkaConfig.publishEvent).toHaveBeenCalledWith(
        "orders-topic",
        expect.objectContaining({
          eventId: "event-123",
          eventType: "order.created",
          data: { orderId: "123" },
        }),
        "event-123"
      );
    });

    it("auto-connects if not connected", async () => {
      const event = { eventType: "test", metadata: {}, payload: {} };
      await adapter.publish(event);
      expect(mockKafkaConfig.connect).toHaveBeenCalled();
      expect(adapter.isConnected).toBe(true);
    });

    it("throws if publishEvent fails", async () => {
      mockKafkaConfig.publishEvent.mockRejectedValueOnce(new Error("Publish failed"));
      const event = { eventType: "test", metadata: {}, payload: {} };
      await expect(adapter.publish(event)).rejects.toThrow("Publish failed");
    });
  });

  describe("publishBatch", () => {
    it("publishes multiple events", async () => {
      adapter.setTopicMap({ "batch.event": "batch-topic" });
      const events = [
        { eventType: "batch.event", metadata: {}, payload: { id: 1 } },
        { eventType: "batch.event", metadata: {}, payload: { id: 2 } },
      ];
      await adapter.publishBatch(events);
      expect(mockKafkaConfig.publishBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ topic: "batch-topic" }),
        ])
      );
    });

    it("auto-connects if not connected", async () => {
      const events = [{ eventType: "test", metadata: {}, payload: {} }];
      await adapter.publishBatch(events);
      expect(mockKafkaConfig.connect).toHaveBeenCalled();
    });

    it("throws if publishBatch fails", async () => {
      mockKafkaConfig.publishBatch.mockRejectedValueOnce(new Error("Batch failed"));
      const events = [{ eventType: "test", metadata: {}, payload: {} }];
      await expect(adapter.publishBatch(events)).rejects.toThrow("Batch failed");
    });
  });
});
