import { describe, it, expect, vi, afterEach } from 'vitest';
import { BaseEvent } from '../../../src/core/events/BaseEvent.js';
import { EventMetadata, EVENT_VERSIONS, EVENT_SOURCES, EVENT_CATEGORIES } from '../../../src/core/events/EventMetadata.js';

describe('EventMetadata', () => {
  it('should generate default metadata with auto-generated eventId and timestamp', () => {
    const meta = new EventMetadata({ eventType: 'TEST_EVENT' });
    expect(meta.eventId).toBeDefined();
    expect(meta.eventType).toBe('TEST_EVENT');
    expect(meta.source).toBe(EVENT_SOURCES.INTERNAL);
    expect(meta.category).toBe(EVENT_CATEGORIES.DOMAIN);
    expect(meta.version).toBe(EVENT_VERSIONS.CURRENT);
    expect(meta.correlationId).toBeNull();
    expect(meta.causationId).toBeNull();
    expect(meta.timestamp).toBeDefined();
    expect(new Date(meta.timestamp).toISOString()).toBe(meta.timestamp);
  });

  it('should accept custom metadata values', () => {
    const meta = new EventMetadata({
      eventType: 'CUSTOM',
      source: 'test-source',
      category: EVENT_CATEGORIES.INFRASTRUCTURE,
      version: '2.0',
      correlationId: 'corr-123',
      causationId: 'cause-456',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
    expect(meta.source).toBe('test-source');
    expect(meta.category).toBe(EVENT_CATEGORIES.INFRASTRUCTURE);
    expect(meta.version).toBe('2.0');
    expect(meta.correlationId).toBe('corr-123');
    expect(meta.causationId).toBe('cause-456');
    expect(meta.timestamp).toBe('2025-01-01T00:00:00.000Z');
  });

  it('should serialize to JSON', () => {
    const meta = new EventMetadata({ eventType: 'SERIALIZE' });
    const json = meta.toJSON();
    expect(json).toHaveProperty('eventId');
    expect(json).toHaveProperty('eventType', 'SERIALIZE');
    expect(json).toHaveProperty('source');
    expect(json).toHaveProperty('version');
    expect(json).toHaveProperty('timestamp');
  });

  it('should reconstruct from JSON', () => {
    const original = new EventMetadata({ eventType: 'RECON', source: 'src' });
    const json = original.toJSON();
    const restored = EventMetadata.fromJSON(json);
    expect(restored.eventType).toBe('RECON');
    expect(restored.source).toBe('src');
    expect(restored.eventId).toBe(original.eventId);
  });
});

describe('BaseEvent', () => {
  it('should create an event with required eventType', () => {
    const event = new BaseEvent({ eventType: 'ORDER_CREATED' });
    expect(event.eventType).toBe('ORDER_CREATED');
    expect(event.payload).toEqual({});
    expect(event.eventId).toBeDefined();
    expect(event.timestamp).toBeDefined();
  });

  it('should throw if eventType is missing', () => {
    expect(() => new BaseEvent()).toThrow('BaseEvent requires a non-empty eventType string');
    expect(() => new BaseEvent({ eventType: '' })).toThrow('BaseEvent requires a non-empty eventType string');
  });

  it('should accept a payload', () => {
    const payload = { orderId: '123', amount: 500 };
    const event = new BaseEvent({ eventType: 'PAYMENT', payload });
    expect(event.payload).toEqual(payload);
  });

  it('should support fluent correlation/causation id chaining', () => {
    const event = new BaseEvent({ eventType: 'CHAIN' })
      .withCorrelationId('corr-1')
      .withCausationId('cause-1');
    expect(event.correlationId).toBe('corr-1');
    expect(event.toJSON().metadata.correlationId).toBe('corr-1');
    expect(event.toJSON().metadata.causationId).toBe('cause-1');
  });

  it('should serialize and deserialize from JSON', () => {
    const event = new BaseEvent({
      eventType: 'ROUND_TRIP',
      payload: { key: 'value' },
      source: 'test',
    });
    const json = event.toJSON();
    const restored = BaseEvent.fromJSON(json);
    expect(restored.eventType).toBe('ROUND_TRIP');
    expect(restored.payload).toEqual({ key: 'value' });
    expect(restored.eventId).toBe(event.eventId);
  });

  it('should accept an existing EventMetadata instance', () => {
    const meta = new EventMetadata({ eventType: 'META_TEST', source: 'custom' });
    const event = new BaseEvent({ eventType: 'META_TEST', metadata: meta });
    expect(event.metadata).toBe(meta);
    expect(event.source).toBe('custom');
  });

  it('should expose category accessor', () => {
    const event = new BaseEvent({ eventType: 'CAT', category: EVENT_CATEGORIES.INFRASTRUCTURE });
    expect(event.category).toBe(EVENT_CATEGORIES.INFRASTRUCTURE);
  });
});
