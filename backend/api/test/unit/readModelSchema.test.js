/**
 * Unit tests for read-model-schema.js
 *
 * Tests the order read-model schema validation and derivation utilities.
 * This module is dependency-free so any test runner can import it.
 */
import { describe, it, expect } from 'vitest';
import {
  ORDER_READ_MODEL_TABLE,
  ORDER_READ_MODEL_COLUMNS,
  ORDER_READ_MODEL_PRIMARY_KEY,
  OrderReadModelSchemaError,
  assertOrderReadModelRow,
  deriveOrderStatus,
  deriveEventTypeFromTimeline,
} from '../../src/core/orders/read-model-schema.js';

describe('read-model-schema constants', () => {
  it('ORDER_READ_MODEL_TABLE is orders_read_model', () => {
    expect(ORDER_READ_MODEL_TABLE).toBe('orders_read_model');
  });

  it('ORDER_READ_MODEL_COLUMNS contains the expected columns', () => {
    expect(ORDER_READ_MODEL_COLUMNS).toContain('order_id');
    expect(ORDER_READ_MODEL_COLUMNS).toContain('payload');
    expect(ORDER_READ_MODEL_COLUMNS).toContain('event_type');
    expect(ORDER_READ_MODEL_COLUMNS).toContain('version');
    expect(ORDER_READ_MODEL_COLUMNS).toContain('status');
    expect(ORDER_READ_MODEL_COLUMNS).toContain('timeline');
    expect(ORDER_READ_MODEL_COLUMNS).toContain('updated_at');
    expect(ORDER_READ_MODEL_COLUMNS).toHaveLength(7);
  });

  it('ORDER_READ_MODEL_COLUMNS is frozen', () => {
    expect(Object.isFrozen(ORDER_READ_MODEL_COLUMNS)).toBe(true);
  });

  it('ORDER_READ_MODEL_PRIMARY_KEY is order_id', () => {
    expect(ORDER_READ_MODEL_PRIMARY_KEY).toBe('order_id');
  });
});

describe('OrderReadModelSchemaError', () => {
  it('extends Error', () => {
    const err = new OrderReadModelSchemaError('test message');
    expect(err).toBeInstanceOf(Error);
  });

  it('has correct name and code', () => {
    const err = new OrderReadModelSchemaError('schema drift');
    expect(err.name).toBe('OrderReadModelSchemaError');
    expect(err.code).toBe('ORDER_READ_MODEL_SCHEMA_DRIFT');
  });

  it('message is preserved', () => {
    const err = new OrderReadModelSchemaError('column mismatch');
    expect(err.message).toBe('column mismatch');
  });
});

describe('assertOrderReadModelRow', () => {
  it('returns the row when all columns are valid', () => {
    const row = {
      order_id: 'ord-123',
      payload: { amount: 5000 },
      event_type: 'ORDER_CREATED',
      version: 1,
      status: 'created',
      timeline: [],
      updated_at: '2024-01-01T00:00:00Z',
    };
    expect(assertOrderReadModelRow(row)).toBe(row);
  });

  it('returns the row even when optional columns are omitted', () => {
    const row = {
      order_id: 'ord-456',
      payload: {},
    };
    expect(assertOrderReadModelRow(row)).toBe(row);
  });

  it('throws OrderReadModelSchemaError for null', () => {
    expect(() => assertOrderReadModelRow(null)).toThrow(OrderReadModelSchemaError);
    expect(() => assertOrderReadModelRow(null)).toThrow('must be an object');
  });

  it('throws for non-object values', () => {
    expect(() => assertOrderReadModelRow('string')).toThrow(OrderReadModelSchemaError);
    expect(() => assertOrderReadModelRow(42)).toThrow(OrderReadModelSchemaError);
    expect(() => assertOrderReadModelRow(undefined)).toThrow(OrderReadModelSchemaError);
  });

  it('throws for array', () => {
    expect(() => assertOrderReadModelRow([])).toThrow(OrderReadModelSchemaError);
    expect(() => assertOrderReadModelRow([1, 2])).toThrow(OrderReadModelSchemaError);
  });

  it('throws when row contains a column not in the canonical schema', () => {
    const row = {
      order_id: 'ord-123',
      payload: {},
      event_type: 'ORDER_CREATED',
      version: 1,
      status: 'created',
      timeline: [],
      updated_at: '2024-01-01T00:00:00Z',
      extra_column: 'forbidden',
    };
    expect(() => assertOrderReadModelRow(row)).toThrow(OrderReadModelSchemaError);
    expect(() => assertOrderReadModelRow(row)).toThrow('extra_column');
  });

  it('throws when multiple extra columns are present', () => {
    const row = {
      order_id: 'ord-123',
      payload: {},
      event_type: 'ORDER_CREATED',
      version: 1,
      status: 'created',
      timeline: [],
      updated_at: '2024-01-01T00:00:00Z',
      foo: 'bar',
      baz: 'qux',
    };
    expect(() => assertOrderReadModelRow(row)).toThrow('foo');
    expect(() => assertOrderReadModelRow(row)).toThrow('baz');
  });

  it('throws when order_id is missing', () => {
    const row = {
      payload: {},
      event_type: 'ORDER_CREATED',
      version: 1,
      status: 'created',
      timeline: [],
      updated_at: '2024-01-01T00:00:00Z',
    };
    expect(() => assertOrderReadModelRow(row)).toThrow(OrderReadModelSchemaError);
    expect(() => assertOrderReadModelRow(row)).toThrow('order_id');
  });

  it('throws when order_id is null', () => {
    const row = {
      order_id: null,
      payload: {},
      event_type: 'ORDER_CREATED',
      version: 1,
      status: 'created',
      timeline: [],
      updated_at: '2024-01-01T00:00:00Z',
    };
    expect(() => assertOrderReadModelRow(row)).toThrow(OrderReadModelSchemaError);
  });

  it('throws when order_id is an empty string', () => {
    const row = {
      order_id: '',
      payload: {},
      event_type: 'ORDER_CREATED',
      version: 1,
      status: 'created',
      timeline: [],
      updated_at: '2024-01-01T00:00:00Z',
    };
    expect(() => assertOrderReadModelRow(row)).toThrow(OrderReadModelSchemaError);
  });
});

describe('deriveOrderStatus', () => {
  it('returns lowercase trimmed status for valid uppercase status', () => {
    expect(deriveOrderStatus({ status: 'CREATED' })).toBe('created');
    expect(deriveOrderStatus({ status: 'ASSIGNED' })).toBe('assigned');
    expect(deriveOrderStatus({ status: 'IN_TRANSIT' })).toBe('in_transit');
    expect(deriveOrderStatus({ status: 'DELIVERED' })).toBe('delivered');
    expect(deriveOrderStatus({ status: 'CANCELLED' })).toBe('cancelled');
  });

  it('returns lowercase for mixed-case status', () => {
    expect(deriveOrderStatus({ status: 'In_Transit' })).toBe('in_transit');
    expect(deriveOrderStatus({ status: 'Delivered' })).toBe('delivered');
  });

  it('trims whitespace before lowercasing', () => {
    expect(deriveOrderStatus({ status: '  ASSIGNED  ' })).toBe('assigned');
    expect(deriveOrderStatus({ status: '\tDELIVERED\n' })).toBe('delivered');
  });

  it('returns created for empty string', () => {
    expect(deriveOrderStatus({ status: '' })).toBe('created');
  });

  it('returns created for whitespace-only string', () => {
    expect(deriveOrderStatus({ status: '   ' })).toBe('created');
    expect(deriveOrderStatus({ status: '\t\n' })).toBe('created');
  });

  it('returns created for missing status key', () => {
    expect(deriveOrderStatus({})).toBe('created');
    expect(deriveOrderStatus({ other_field: 'value' })).toBe('created');
  });

  it('returns null for null/undefined state', () => {
    expect(deriveOrderStatus(null)).toBeNull();
    expect(deriveOrderStatus(undefined)).toBeNull();
  });

  it('returns null for non-object primitive state', () => {
    expect(deriveOrderStatus('string')).toBeNull();
    expect(deriveOrderStatus(42)).toBeNull();
  });

  it('returns created for empty array (typeof [] === object)', () => {
    expect(deriveOrderStatus([])).toBe('created');
  });

  it('returns created when status is a number', () => {
    expect(deriveOrderStatus({ status: 123 })).toBe('created');
  });
});

describe('deriveEventTypeFromTimeline', () => {
  it('returns last event type using type field', () => {
    const timeline = [
      { type: 'ORDER_CREATED' },
      { type: 'ORDER_ASSIGNED' },
      { type: 'ORDER_PICKED_UP' },
    ];
    expect(deriveEventTypeFromTimeline(timeline)).toBe('ORDER_PICKED_UP');
  });

  it('returns last event type using event_type field', () => {
    const timeline = [
      { event_type: 'ORDER_CREATED' },
      { event_type: 'ORDER_DELIVERED' },
    ];
    expect(deriveEventTypeFromTimeline(timeline)).toBe('ORDER_DELIVERED');
  });

  it('prefers type over event_type when both are present', () => {
    const timeline = [{ type: 'TYPE_VAL', event_type: 'EVENT_TYPE_VAL' }];
    expect(deriveEventTypeFromTimeline(timeline)).toBe('TYPE_VAL');
  });

  it('returns null for empty timeline', () => {
    expect(deriveEventTypeFromTimeline([])).toBeNull();
  });

  it('returns null for non-array input', () => {
    expect(deriveEventTypeFromTimeline(null)).toBeNull();
    expect(deriveEventTypeFromTimeline({})).toBeNull();
    expect(deriveEventTypeFromTimeline('string')).toBeNull();
    expect(deriveEventTypeFromTimeline(42)).toBeNull();
    expect(deriveEventTypeFromTimeline(undefined)).toBeNull();
  });

  it('returns null when last item is null', () => {
    const timeline = [{ type: 'ORDER_CREATED' }, null];
    expect(deriveEventTypeFromTimeline(timeline)).toBeNull();
  });

  it('returns null when last item is a primitive', () => {
    const timeline = [{ type: 'ORDER_CREATED' }, 'string'];
    expect(deriveEventTypeFromTimeline(timeline)).toBeNull();
  });

  it('returns null when last item has neither type nor event_type', () => {
    const timeline = [{ type: 'ORDER_CREATED' }, { status: 'active', data: {} }];
    expect(deriveEventTypeFromTimeline(timeline)).toBeNull();
  });

  it('handles timeline with single item using type', () => {
    expect(deriveEventTypeFromTimeline([{ type: 'ONLY_ITEM' }])).toBe('ONLY_ITEM');
  });

  it('handles timeline with single item using event_type', () => {
    expect(deriveEventTypeFromTimeline([{ event_type: 'ONLY_ITEM' }])).toBe('ONLY_ITEM');
  });
});
