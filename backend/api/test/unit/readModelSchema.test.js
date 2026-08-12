import { describe, it, expect } from 'vitest';
import {
  ORDER_READ_MODEL_COLUMNS,
  ORDER_READ_MODEL_PRIMARY_KEY,
  ORDER_READ_MODEL_TABLE,
  OrderReadModelSchemaError,
  assertOrderReadModelRow,
  deriveOrderStatus,
  deriveEventTypeFromTimeline,
} from '../../src/core/orders/read-model-schema.js';

describe('read-model-schema constants', () => {
  it('exposes the canonical table name and columns', () => {
    expect(ORDER_READ_MODEL_TABLE).toBe('orders_read_model');
    expect(ORDER_READ_MODEL_PRIMARY_KEY).toBe('order_id');
    expect(ORDER_READ_MODEL_COLUMNS).toEqual([
      'order_id',
      'payload',
      'event_type',
      'version',
      'status',
      'timeline',
      'updated_at',
    ]);
    expect(Object.isFrozen(ORDER_READ_MODEL_COLUMNS)).toBe(true);
  });
});

describe('assertOrderReadModelRow', () => {
  it('returns the row unchanged when it is valid', () => {
    const row = { order_id: 'o1', payload: {} };
    expect(assertOrderReadModelRow(row)).toBe(row);
  });

  it('throws for a non-object row', () => {
    expect(() => assertOrderReadModelRow(null)).toThrow(OrderReadModelSchemaError);
    expect(() => assertOrderReadModelRow('str')).toThrow(OrderReadModelSchemaError);
    expect(() => assertOrderReadModelRow([])).toThrow(OrderReadModelSchemaError);
  });

  it('throws for unknown columns', () => {
    expect(() => assertOrderReadModelRow({ order_id: 'o1', bogus: 1 })).toThrow(/bogus/);
  });

  it('throws when order_id is missing', () => {
    expect(() => assertOrderReadModelRow({ payload: {} })).toThrow(/order_id/);
  });

  it('sets a machine-readable code', () => {
    try {
      assertOrderReadModelRow({ nope: true });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe('ORDER_READ_MODEL_SCHEMA_DRIFT');
    }
  });
});

describe('deriveOrderStatus', () => {
  it('returns null for a non-object state', () => {
    expect(deriveOrderStatus(null)).toBeNull();
    expect(deriveOrderStatus('x')).toBeNull();
  });

  it('lowercases an uppercase status', () => {
    expect(deriveOrderStatus({ status: 'CREATED' })).toBe('created');
    expect(deriveOrderStatus({ status: 'ASSIGNED' })).toBe('assigned');
  });

  it('defaults to created for a missing or blank status', () => {
    expect(deriveOrderStatus({})).toBe('created');
    expect(deriveOrderStatus({ status: '' })).toBe('created');
  });

  it('trims surrounding whitespace', () => {
    expect(deriveOrderStatus({ status: '  CANCELLED  ' })).toBe('cancelled');
  });
});

describe('deriveEventTypeFromTimeline', () => {
  it('returns null for an empty or non-array timeline', () => {
    expect(deriveEventTypeFromTimeline(null)).toBeNull();
    expect(deriveEventTypeFromTimeline([])).toBeNull();
    expect(deriveEventTypeFromTimeline('x')).toBeNull();
  });

  it('returns the last event type', () => {
    const timeline = [{ type: 'created' }, { type: 'assigned' }, { type: 'delivered' }];
    expect(deriveEventTypeFromTimeline(timeline)).toBe('delivered');
  });

  it('falls back to event_type when type is absent', () => {
    const timeline = [{ event_type: 'cancelled' }];
    expect(deriveEventTypeFromTimeline(timeline)).toBe('cancelled');
  });

  it('returns null when the last entry is not an object', () => {
    expect(deriveEventTypeFromTimeline(['string-entry'])).toBeNull();
  });
});
