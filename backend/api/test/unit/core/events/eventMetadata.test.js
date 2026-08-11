import { describe, it, expect } from 'vitest';
import {
  EVENT_VERSIONS,
  EVENT_SOURCES,
  EVENT_CATEGORIES,
  EventMetadata,
} from '../../../../src/core/events/EventMetadata.js';

describe('EventMetadata constants', () => {
  it('exposes the current version', () => {
    expect(EVENT_VERSIONS.CURRENT).toBe('1.0');
  });

  it('exposes the known event sources', () => {
    expect(EVENT_SOURCES.ORDER_SERVICE).toBe('order-service');
    expect(EVENT_SOURCES.ESCROW_SERVICE).toBe('escrow-service');
    expect(EVENT_SOURCES.TRACKING_SERVICE).toBe('tracking-service');
    expect(EVENT_SOURCES.ML_SERVICE).toBe('ml-service');
    expect(EVENT_SOURCES.WORKER).toBe('worker');
    expect(EVENT_SOURCES.INTERNAL).toBe('internal');
  });

  it('exposes the domain and infrastructure categories', () => {
    expect(EVENT_CATEGORIES.DOMAIN).toBe('domain');
    expect(EVENT_CATEGORIES.INFRASTRUCTURE).toBe('infrastructure');
  });
});

describe('EventMetadata', () => {
  it('fills defaults when constructed with only an event type', () => {
    const metadata = new EventMetadata({ eventType: 'order.created' });
    expect(typeof metadata.eventId).toBe('string');
    expect(metadata.eventId.length).toBeGreaterThan(0);
    expect(metadata.eventType).toBe('order.created');
    expect(metadata.source).toBe(EVENT_SOURCES.INTERNAL);
    expect(metadata.category).toBe(EVENT_CATEGORIES.DOMAIN);
    expect(metadata.version).toBe(EVENT_VERSIONS.CURRENT);
    expect(metadata.correlationId).toBeNull();
    expect(metadata.causationId).toBeNull();
    expect(typeof metadata.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(metadata.timestamp))).toBe(false);
  });

  it('preserves explicitly provided values', () => {
    const timestamp = '2026-08-01T10:00:00.000Z';
    const metadata = new EventMetadata({
      eventId: 'evt-1',
      eventType: 'payment.received',
      source: EVENT_SOURCES.PAYMENT_SERVICE,
      category: EVENT_CATEGORIES.DOMAIN,
      version: '2.0',
      correlationId: 'corr-1',
      causationId: 'cause-1',
      timestamp,
    });
    expect(metadata.eventId).toBe('evt-1');
    expect(metadata.eventType).toBe('payment.received');
    expect(metadata.source).toBe(EVENT_SOURCES.PAYMENT_SERVICE);
    expect(metadata.category).toBe(EVENT_CATEGORIES.DOMAIN);
    expect(metadata.version).toBe('2.0');
    expect(metadata.correlationId).toBe('corr-1');
    expect(metadata.causationId).toBe('cause-1');
    expect(metadata.timestamp).toBe(timestamp);
  });

  it('toJSON returns the full metadata envelope', () => {
    const metadata = new EventMetadata({ eventType: 'order.created', eventId: 'evt-1' });
    expect(metadata.toJSON()).toEqual({
      eventId: 'evt-1',
      eventType: 'order.created',
      source: EVENT_SOURCES.INTERNAL,
      category: EVENT_CATEGORIES.DOMAIN,
      version: EVENT_VERSIONS.CURRENT,
      correlationId: null,
      causationId: null,
      timestamp: metadata.timestamp,
    });
  });

  it('fromJSON rebuilds an equivalent instance', () => {
    const original = new EventMetadata({
      eventId: 'evt-1',
      eventType: 'order.created',
      source: EVENT_SOURCES.ORDER_SERVICE,
      correlationId: 'corr-1',
    });
    const rebuilt = EventMetadata.fromJSON(original.toJSON());
    expect(rebuilt).toBeInstanceOf(EventMetadata);
    expect(rebuilt.toJSON()).toEqual(original.toJSON());
  });

  it('fromJSON accepts an empty object', () => {
    const rebuilt = EventMetadata.fromJSON({});
    expect(rebuilt).toBeInstanceOf(EventMetadata);
    expect(rebuilt.eventType).toBeUndefined();
    expect(rebuilt.source).toBe(EVENT_SOURCES.INTERNAL);
  });
});
