import { describe, it, expect } from 'vitest';
import { BaseEvent } from '../../../../src/core/events/BaseEvent.js';
import { EventMetadata } from '../../../../src/core/events/EventMetadata.js';
import { EVENT_SOURCES, EVENT_CATEGORIES, EVENT_VERSIONS } from '../../../../src/core/events/EventMetadata.js';

describe('BaseEvent', () => {
  it('rejects construction without a non-empty eventType string', () => {
    expect(() => new BaseEvent({})).toThrow('BaseEvent requires a non-empty eventType string');
    expect(() => new BaseEvent({ eventType: '' })).toThrow('BaseEvent requires a non-empty eventType string');
    expect(() => new BaseEvent({ eventType: 42 })).toThrow('BaseEvent requires a non-empty eventType string');
  });

  it('applies defaults when only eventType is provided', () => {
    const event = new BaseEvent({ eventType: 'order.created' });
    expect(event.eventType).toBe('order.created');
    expect(event.payload).toEqual({});
    expect(event.source).toBe(EVENT_SOURCES.INTERNAL);
    expect(event.category).toBe(EVENT_CATEGORIES.DOMAIN);
    expect(event.metadata.version).toBe(EVENT_VERSIONS.CURRENT);
    expect(event.correlationId).toBeNull();
    expect(typeof event.eventId).toBe('string');
    expect(typeof event.timestamp).toBe('string');
  });

  it('preserves explicit construction values', () => {
    const event = new BaseEvent({
      eventType: 'payment.received',
      payload: { amount: 100 },
      source: EVENT_SOURCES.PAYMENT_SERVICE,
      category: EVENT_CATEGORIES.INFRASTRUCTURE,
      version: '2.0',
      correlationId: 'corr-1',
      causationId: 'cause-1',
    });
    expect(event.eventType).toBe('payment.received');
    expect(event.payload).toEqual({ amount: 100 });
    expect(event.source).toBe(EVENT_SOURCES.PAYMENT_SERVICE);
    expect(event.category).toBe(EVENT_CATEGORIES.INFRASTRUCTURE);
    expect(event.metadata.version).toBe('2.0');
    expect(event.correlationId).toBe('corr-1');
    expect(event.metadata.causationId).toBe('cause-1');
  });

  it('uses an existing EventMetadata instance when provided', () => {
    const metadata = new EventMetadata({ eventId: 'evt-42', eventType: 'order.created' });
    const event = new BaseEvent({ eventType: 'order.created', metadata });
    expect(event.metadata).toBe(metadata);
    expect(event.eventId).toBe('evt-42');
  });

  it('exposes the accessor getters', () => {
    const event = new BaseEvent({ eventType: 'order.created' });
    expect(event.eventId).toBe(event.metadata.eventId);
    expect(event.eventType).toBe(event.metadata.eventType);
    expect(event.timestamp).toBe(event.metadata.timestamp);
    expect(event.source).toBe(event.metadata.source);
    expect(event.category).toBe(event.metadata.category);
    expect(event.correlationId).toBe(event.metadata.correlationId);
  });

  it('withCorrelationId mutates and returns the same instance', () => {
    const event = new BaseEvent({ eventType: 'order.created' });
    const returned = event.withCorrelationId('corr-9');
    expect(returned).toBe(event);
    expect(event.correlationId).toBe('corr-9');
  });

  it('withCausationId mutates and returns the same instance', () => {
    const event = new BaseEvent({ eventType: 'order.created' });
    const returned = event.withCausationId('cause-9');
    expect(returned).toBe(event);
    expect(event.metadata.causationId).toBe('cause-9');
  });

  it('toJSON returns the metadata envelope and payload', () => {
    const event = new BaseEvent({ eventType: 'order.created', payload: { id: '1' } });
    expect(event.toJSON()).toEqual({
      metadata: event.metadata.toJSON(),
      payload: { id: '1' },
    });
  });

  it('fromJSON round-trips to an equivalent instance', () => {
    const original = new BaseEvent({
      eventType: 'order.created',
      payload: { id: '1' },
      source: EVENT_SOURCES.ORDER_SERVICE,
      correlationId: 'corr-1',
    });
    const rebuilt = BaseEvent.fromJSON(original.toJSON());
    expect(rebuilt).toBeInstanceOf(BaseEvent);
    expect(rebuilt.toJSON()).toEqual(original.toJSON());
  });
});
