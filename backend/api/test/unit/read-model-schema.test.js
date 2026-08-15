import { describe, it, expect } from 'vitest';
import {
  assertOrderReadModelRow,
  deriveOrderStatus,
  deriveEventTypeFromTimeline,
  ORDER_READ_MODEL_TABLE,
  ORDER_READ_MODEL_COLUMNS,
  ORDER_READ_MODEL_PRIMARY_KEY,
  OrderReadModelSchemaError,
} from '../../src/core/orders/read-model-schema.js';

describe('read-model-schema', () => {
  describe('ORDER_READ_MODEL_TABLE', () => {
    it('is orders_read_model', () => {
      expect(ORDER_READ_MODEL_TABLE).toBe('orders_read_model');
    });
  });

  describe('ORDER_READ_MODEL_COLUMNS', () => {
    it('contains all expected columns in DDL order', () => {
      expect(ORDER_READ_MODEL_COLUMNS).toContain('order_id');
      expect(ORDER_READ_MODEL_COLUMNS).toContain('payload');
      expect(ORDER_READ_MODEL_COLUMNS).toContain('event_type');
      expect(ORDER_READ_MODEL_COLUMNS).toContain('version');
      expect(ORDER_READ_MODEL_COLUMNS).toContain('status');
      expect(ORDER_READ_MODEL_COLUMNS).toContain('timeline');
      expect(ORDER_READ_MODEL_COLUMNS).toContain('updated_at');
    });

    it('has exactly 7 columns', () => {
      expect(ORDER_READ_MODEL_COLUMNS).toHaveLength(7);
    });
  });

  describe('ORDER_READ_MODEL_PRIMARY_KEY', () => {
    it('is order_id', () => {
      expect(ORDER_READ_MODEL_PRIMARY_KEY).toBe('order_id');
    });
  });

  describe('assertOrderReadModelRow', () => {
    it('returns the row when valid', () => {
      const row = { order_id: 'ord-1', payload: {}, event_type: 'ORDER_CREATED', version: 1, status: 'created', timeline: [], updated_at: '2024-01-01' };
      const result = assertOrderReadModelRow(row);
      expect(result).toEqual(row);
    });

    it('throws when row is null', () => {
      expect(() => assertOrderReadModelRow(null)).toThrow(OrderReadModelSchemaError);
    });

    it('throws when row is undefined', () => {
      expect(() => assertOrderReadModelRow(undefined)).toThrow(OrderReadModelSchemaError);
    });

    it('throws when row is not an object', () => {
      expect(() => assertOrderReadModelRow('string')).toThrow(OrderReadModelSchemaError);
      expect(() => assertOrderReadModelRow(123)).toThrow(OrderReadModelSchemaError);
    });

    it('throws when row is an array', () => {
      expect(() => assertOrderReadModelRow([])).toThrow(OrderReadModelSchemaError);
    });

    it('throws when row contains unknown column', () => {
      const row = { order_id: 'ord-1', unknown_column: 'x' };
      expect(() => assertOrderReadModelRow(row)).toThrow('unknown_column');
    });

    it('throws when order_id is missing', () => {
      const row = { payload: {}, event_type: 'ORDER_CREATED' };
      expect(() => assertOrderReadModelRow(row)).toThrow('order_id');
    });

    it('throws with all unknown columns listed', () => {
      const row = { order_id: 'ord-1', foo: '1', bar: '2' };
      expect(() => assertOrderReadModelRow(row)).toThrow('foo, bar');
    });
  });

  describe('deriveOrderStatus', () => {
    it('returns null for null input', () => {
      expect(deriveOrderStatus(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(deriveOrderStatus(undefined)).toBeNull();
    });

    it('returns null for non-object input', () => {
      expect(deriveOrderStatus('string')).toBeNull();
    });

    it('defaults to created for empty string status', () => {
      expect(deriveOrderStatus({ status: '' })).toBe('created');
    });

    it('defaults to created for whitespace-only status', () => {
      expect(deriveOrderStatus({ status: '   ' })).toBe('created');
    });

    it('defaults to created for missing status', () => {
      expect(deriveOrderStatus({})).toBe('created');
    });

    it('lowercases uppercase status', () => {
      expect(deriveOrderStatus({ status: 'ASSIGNED' })).toBe('assigned');
    });

    it('trims whitespace from status', () => {
      expect(deriveOrderStatus({ status: '  pending  ' })).toBe('pending');
    });

    it('returns lowercase status as-is', () => {
      expect(deriveOrderStatus({ status: 'cancelled' })).toBe('cancelled');
    });
  });

  describe('deriveEventTypeFromTimeline', () => {
    it('returns null for null input', () => {
      expect(deriveEventTypeFromTimeline(null)).toBeNull();
    });

    it('returns null for non-array input', () => {
      expect(deriveEventTypeFromTimeline('string')).toBeNull();
    });

    it('returns null for empty array', () => {
      expect(deriveEventTypeFromTimeline([])).toBeNull();
    });

    it('returns null when last entry has no type', () => {
      expect(deriveEventTypeFromTimeline([{ foo: 'bar' }])).toBeNull();
    });

    it('returns type from last entry using type key', () => {
      const timeline = [{ foo: 'bar' }, { type: 'ORDER_ASSIGNED' }];
      expect(deriveEventTypeFromTimeline(timeline)).toBe('ORDER_ASSIGNED');
    });

    it('returns event_type from last entry using event_type key', () => {
      const timeline = [{ foo: 'bar' }, { event_type: 'ORDER_COMPLETED' }];
      expect(deriveEventTypeFromTimeline(timeline)).toBe('ORDER_COMPLETED');
    });

    it('prefers type over event_type when both present', () => {
      const timeline = [{ event_type: 'OLD' }, { type: 'NEW', event_type: 'OLD' }];
      expect(deriveEventTypeFromTimeline(timeline)).toBe('NEW');
    });
  });
});
