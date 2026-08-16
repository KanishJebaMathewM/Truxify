import { describe, it, expect, vi } from "vitest";
import { BaseEvent } from "../../src/core/events/BaseEvent.js";
import { EventMetadata, EVENT_CATEGORIES } from "../../src/core/events/EventMetadata.js";

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('BaseEvent', () => {
  it('creates event with required eventType', () => {
    const event = new BaseEvent({ eventType: 'order.created', source: 'order-service' });
    expect(event.eventType).toBe('order.created');
    expect(event.source).toBe('order-service');
    expect(event.category).toBe(EVENT_CATEGORIES.DOMAIN);
    expect(typeof event.eventId).toBe('string');
    expect(typeof event.timestamp).toBe('string');
  });

  it('throws when eventType is missing', () => {
    expect(() => new BaseEvent({ source: 'test' })).toThrow('BaseEvent requires a non-empty eventType string');
  });

  it('throws when eventType is not a string', () => {
    expect(() => new BaseEvent({ eventType: 123 })).toThrow('BaseEvent requires a non-empty eventType string');
  });

  it('throws when eventType is empty string', () => {
    expect(() => new BaseEvent({ eventType: '' })).toThrow('BaseEvent requires a non-empty eventType string');
  });

  it('accepts custom payload', () => {
    const payload = { orderId: '123', amount: 500 };
    const event = new BaseEvent({ eventType: 'order.paid', source: 'payment', payload });
    expect(event.payload).toEqual(payload);
  });

  it('uses provided correlationId and causationId', () => {
    const event = new BaseEvent({
      eventType: 'test',
      source: 'test',
      correlationId: 'corr-001',
      causationId: 'evt-002',
    });
    expect(event.correlationId).toBe('corr-001');
    expect(event.metadata.causationId).toBe('evt-002');
  });

  it('accepts existing EventMetadata instance', () => {
    const metadata = new EventMetadata({
      eventType: 'order.shipped',
      source: 'fulfillment',
      correlationId: 'corr-123',
    });
    const event = new BaseEvent({ eventType: 'test', metadata });
    expect(event.eventType).toBe('order.shipped');
    expect(event.correlationId).toBe('corr-123');
  });

  it('withCorrelationId mutates and returns self', () => {
    const event = new BaseEvent({ eventType: 'test', source: 'test' });
    const result = event.withCorrelationId('new-corr');
    expect(event.correlationId).toBe('new-corr');
    expect(result).toBe(event); // mutates in place, returns this
  });

  it('withCausationId mutates and returns self', () => {
    const event = new BaseEvent({ eventType: 'test', source: 'test' });
    const result = event.withCausationId('new-cause');
    expect(event.metadata.causationId).toBe('new-cause');
    expect(result).toBe(event);
  });

  it('toJSON returns metadata and payload', () => {
    const payload = { data: 'value' };
    const event = new BaseEvent({
      eventType: 'driver.assigned',
      source: 'dispatch',
      payload,
    });
    const json = event.toJSON();
    expect(json.metadata).toBeDefined();
    expect(json.metadata.eventType).toBe('driver.assigned');
    expect(json.payload).toEqual(payload);
  });

  it('fromJSON reconstructs BaseEvent', () => {
    const original = new BaseEvent({
      eventType: 'order.cancelled',
      source: 'order-service',
      payload: { reason: 'customer_request' },
      correlationId: 'corr-999',
    });
    const json = original.toJSON();
    const reconstructed = BaseEvent.fromJSON(json);
    expect(reconstructed.eventType).toBe('order.cancelled');
    expect(reconstructed.source).toBe('order-service');
    expect(reconstructed.correlationId).toBe('corr-999');
    expect(reconstructed.payload).toEqual({ reason: 'customer_request' });
  });
});
