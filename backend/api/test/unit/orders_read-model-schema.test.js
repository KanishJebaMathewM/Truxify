/**
 * Unit tests for backend/api/src/core/orders/read-model-schema.js
 *
 * Coverage:
 *   - assertOrderReadModelRow: valid row / null / array / non-object / unknown column / missing order_id
 *   - deriveOrderStatus: lowercase status / null for null input / null for undefined / created for empty / trim
 *   - deriveEventTypeFromTimeline: extracts last type / null for empty/null/non-array
 *   - ORDER_READ_MODEL_COLUMNS: contains expected columns
 */
import { describe, it, expect } from 'vitest';
import { assertOrderReadModelRow, deriveOrderStatus, deriveEventTypeFromTimeline, ORDER_READ_MODEL_COLUMNS, OrderReadModelSchemaError } from '../../src/core/orders/read-model-schema.js';

describe('read-model-schema', () => {
  const validRow = { order_id: 'order-123', payload: { customerId: 'cust-1' }, event_type: 'ORDER_CREATED', version: 1, status: 'pending', timeline: [], updated_at: '2026-01-01T00:00:00Z' };

  describe('assertOrderReadModelRow', () => {
    it('accepts a valid row', () => { expect(() => assertOrderReadModelRow(validRow)).not.toThrow(); });
    it('throws for null input', () => { expect(() => assertOrderReadModelRow(null)).toThrow(OrderReadModelSchemaError); });
    it('throws for undefined input', () => { expect(() => assertOrderReadModelRow(undefined)).toThrow(OrderReadModelSchemaError); });
    it('throws for array input', () => { expect(() => assertOrderReadModelRow([])).toThrow(OrderReadModelSchemaError); });
    it('throws for non-object input', () => { expect(() => assertOrderReadModelRow('string')).toThrow(OrderReadModelSchemaError); });
    it('throws when unknown columns are present', () => {
      const row = { ...validRow, unknown_column: 'value' };
      expect(() => assertOrderReadModelRow(row)).toThrow(/unknown_column/);
    });
    it('throws when order_id is missing', () => {
      const { order_id, ...row } = validRow;
      expect(() => assertOrderReadModelRow(row)).toThrow(/order_id/);
    });
    it('returns the row on success', () => { expect(assertOrderReadModelRow(validRow)).toBe(validRow); });
  });

  describe('deriveOrderStatus', () => {
    it('returns lowercase status', () => { expect(deriveOrderStatus({ status: 'ASSIGNED' })).toBe('assigned'); });
    it('returns lowercase status for lowercase input', () => { expect(deriveOrderStatus({ status: 'pending' })).toBe('pending'); });
    it('returns null for null input', () => { expect(deriveOrderStatus(null)).toBe(null); });
    it('returns null for undefined input', () => { expect(deriveOrderStatus(undefined)).toBe(null); });
    it('returns "created" for empty status string', () => { expect(deriveOrderStatus({ status: '' })).toBe('created'); });
    it('returns "created" for whitespace-only status', () => { expect(deriveOrderStatus({ status: '   ' })).toBe('created'); });
    it('trims whitespace from status', () => { expect(deriveOrderStatus({ status: '  CANCELLED  ' })).toBe('cancelled'); });
  });

  describe('deriveEventTypeFromTimeline', () => {
    it('extracts last event type from timeline', () => {
      const tl = [{ type: 'ORDER_CREATED' }, { type: 'ORDER_ASSIGNED' }, { event_type: 'ORDER_DELIVERED' }];
      expect(deriveEventTypeFromTimeline(tl)).toBe('ORDER_DELIVERED');
    });
    it('returns null for empty timeline', () => { expect(deriveEventTypeFromTimeline([])).toBeNull(); });
    it('returns null for null input', () => { expect(deriveEventTypeFromTimeline(null)).toBeNull(); });
    it('returns null for non-array input', () => { expect(deriveEventTypeFromTimeline({})).toBeNull(); });
    it('returns null for last entry without type', () => {
      const tl = [{ type: 'ORDER_CREATED' }, { unknown: 'field' }];
      expect(deriveEventTypeFromTimeline(tl)).toBeNull();
    });
  });

  describe('ORDER_READ_MODEL_COLUMNS', () => {
    it('contains order_id', () => { expect(ORDER_READ_MODEL_COLUMNS).toContain('order_id'); });
    it('contains payload', () => { expect(ORDER_READ_MODEL_COLUMNS).toContain('payload'); });
    it('contains status', () => { expect(ORDER_READ_MODEL_COLUMNS).toContain('status'); });
    it('contains timeline', () => { expect(ORDER_READ_MODEL_COLUMNS).toContain('timeline'); });
  });
});
