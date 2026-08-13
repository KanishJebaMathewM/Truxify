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


// === Spec 6 test ===
import { describe, it, expect } from 'vitest';
import { sanitizeKey, sanitizeQueryParams } from '../../src/middleware/suspiciousRequests.js';
describe('sanitizeKey', () => {
  it('rejects __proto__', () => { expect(sanitizeKey('__proto__')).toBeNull(); });
  it('rejects constructor', () => { expect(sanitizeKey('constructor')).toBeNull(); });
  it('accepts normal', () => { expect(sanitizeKey('name')).toBe('name'); });
});
describe('sanitizeQueryParams', () => {
  it('strips dangerous', () => {
    expect(sanitizeQueryParams({ name: 'x', __proto__: 'y' })).toEqual({ name: 'x' });
  });
  it('null → {}', () => { expect(sanitizeQueryParams(null)).toEqual({}); });
});

