import { describe, it, expect } from 'vitest';
import { validateOrderProjection } from '../../cqrs/order.read.model.js';
describe('validateOrderProjection', () => {
  it('valid', () => { expect(validateOrderProjection({ orderId: 'o', status: 'OK', updatedAt: '2026-01-01T00:00:00Z' })).toBe(true); });
  it('missing', () => { expect(validateOrderProjection({ orderId: 'o' })).toBe(false); });
});
