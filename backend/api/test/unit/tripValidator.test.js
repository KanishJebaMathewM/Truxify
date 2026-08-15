import { describe, it, expect, vi } from 'vitest';
import { tripValidator } from '../../src/middleware/tripValidator.js';

describe('tripValidator Middleware', () => {
  it('allows valid trip ID in params', () => {
    const req = { params: { id: 'trip-123' } };
    const res = {};
    const next = vi.fn();

    tripValidator.validate(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
