import { describe, it, expect } from 'vitest';
import { DomainError } from '../../../../src/services/order/domainError.js';

describe('DomainError', () => {
  it('creates DomainError with message and status', () => {
    const err = new DomainError(404, { error: 'Order not found' });
    expect(err.message).toBe('Order not found');
    expect(err.status).toBe(404);
    expect(err.name).toBe('DomainError');
  });
});
