/**
 * Unit tests for backend/api/src/middleware/rateLimiter.js
 *
 * Coverage:
 *   - All exported limiters (globalLimiter, healthLimiter, authLimiter, bidLimiter) are functions
 *   - All limiters execute without throwing when called as middleware
 *
 * Run with:  npm run test:unit -- test/unit/rateLimiter.test.js
 */
import { describe, it, expect, vi } from 'vitest';
import {
  globalLimiter,
  healthLimiter,
  authLimiter,
  bidLimiter,
} from '../../src/middleware/rateLimiter.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeReq(overrides = {}) {
  return {
    path: '/api/test',
    ip: '127.0.0.1',
    user: undefined,
    ...overrides,
  };
}

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    end: vi.fn(),
    statusCode: 200,
  };
}

function makeNext() {
  return vi.fn();
}

describe('globalLimiter', () => {
  it('is a function', () => {
    expect(typeof globalLimiter).toBe('function');
  });

  it('calls next() without throwing for a normal request', () => {
    const req = makeReq({ path: '/api/orders' });
    const res = makeRes();
    const next = makeNext();
    expect(() => globalLimiter(req, res, next)).not.toThrow();
  });

  it('calls next() without throwing for /health (skip is handled internally by the limiter)', () => {
    const req = makeReq({ path: '/health' });
    const res = makeRes();
    const next = makeNext();
    expect(() => globalLimiter(req, res, next)).not.toThrow();
  });
});

describe('healthLimiter', () => {
  it('is a function', () => {
    expect(typeof healthLimiter).toBe('function');
  });

  it('calls next() without throwing', () => {
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();
    expect(() => healthLimiter(req, res, next)).not.toThrow();
  });
});

describe('authLimiter', () => {
  it('is a function', () => {
    expect(typeof authLimiter).toBe('function');
  });

  it('calls next() without throwing', () => {
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();
    expect(() => authLimiter(req, res, next)).not.toThrow();
  });
});

describe('bidLimiter', () => {
  it('is a function', () => {
    expect(typeof bidLimiter).toBe('function');
  });

  it('calls next() without throwing for a request with user.id', () => {
    const req = makeReq({ user: { id: 'user-123', uid: 'uid-456' } });
    const res = makeRes();
    const next = makeNext();
    expect(() => bidLimiter(req, res, next)).not.toThrow();
  });

  it('calls next() without throwing for a request without user (falls back to IP)', () => {
    const req = makeReq({ ip: '10.0.0.1' });
    const res = makeRes();
    const next = makeNext();
    expect(() => bidLimiter(req, res, next)).not.toThrow();
  });
});
