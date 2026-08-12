import { describe, it, expect, vi } from 'vitest';
import suspiciousRequests from '../../src/middleware/suspiciousRequests.js';

describe('suspiciousRequests Middleware', () => {
  it('calls next() for normal requests', () => {
    const req = { headers: {}, query: {}, body: {} };
    const res = {};
    const next = vi.fn();

    suspiciousRequests(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
