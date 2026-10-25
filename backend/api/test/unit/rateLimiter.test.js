import { describe, it, expect, vi } from 'vitest';
import {
  normalizeIp,
  safeIpKeyGenerator,
  userKeyGenerator,
  isSuspiciousForwardedHeader,
  globalLimiter,
  createStore,
  __testing,
} from '../../src/middleware/rateLimiter.js';

describe('rateLimiter helpers', () => {
  describe('normalizeIp', () => {
    it('returns unknown for invalid/missing IP', () => {
  expect(normalizeIp()).toBe('unknown');
  expect(normalizeIp(null)).toBe('unknown');
  expect(normalizeIp('')).toBe('unknown');
});

    it('normalizes IPv4 and mapped IPv4 addresses', () => {
      expect(normalizeIp('192.168.1.1')).toBe('192.168.1.1');
      expect(normalizeIp('::ffff:192.168.1.1')).toBe('192.168.1.1');
    });

    it('normalizes loopback addresses', () => {
  expect(normalizeIp('127.0.0.1')).toBe('127.0.0.1');
  expect(normalizeIp('::1')).toBe('127.0.0.1');
});

    it('normalizes IPv6 addresses to a /64 prefix', () => {
      expect(normalizeIp('2001:db8:abcd:1234:5678:90ab:cdef:1234')).toBe(
        '2001:db8:abcd:1234::/64',
      );
    });
  });

  describe('safeIpKeyGenerator', () => {
    it('generates a stable key for IPv4 and IPv6 addresses', () => {
      expect(
        safeIpKeyGenerator({
          ip: '192.168.1.10',
          socket: { remoteAddress: '192.168.1.10' },
          headers: {},
          ips: [],
        }),
      ).toBe('192.168.1.10');

      expect(
        safeIpKeyGenerator({
          ip: '2001:db8:abcd:1234:5678:90ab:cdef:1234',
          socket: {
            remoteAddress: '2001:db8:abcd:1234:5678:90ab:cdef:1234',
          },
          headers: {},
          ips: [],
        }),
      ).toBe('2001:db8:abcd:1234::/64');
    });

    it('uses the forwarded client IP when it is valid', () => {
      expect(
        safeIpKeyGenerator({
          ip: '10.0.0.1',
          socket: { remoteAddress: '10.0.0.1' },
          headers: {
            'x-forwarded-for': '203.0.113.10',
          },
          ips: ['203.0.113.10'],
        }),
      ).toBe('203.0.113.10');
    });

    it('uses the trusted first proxy IP from req.ips', () => {
      expect(
        safeIpKeyGenerator({
          ip: '10.0.0.1',
          socket: { remoteAddress: '10.0.0.1' },
          headers: {},
          ips: ['203.0.113.20', '10.0.0.1'],
        }),
      ).toBe('203.0.113.20');
    });

    it('falls back to socket address for suspicious X-Forwarded-For headers', () => {
      expect(
        safeIpKeyGenerator({
          ip: '10.0.0.1',
          socket: { remoteAddress: '10.0.0.1' },
          headers: {
            'x-forwarded-for':
              '203.0.113.10, 198.51.100.20, 192.0.2.1, 10.0.0.1',
          },
          ips: [],
        }),
      ).toBe('10.0.0.1');
    });
  });

  describe('userKeyGenerator', () => {
    it('uses the user id when available', () => {
      const req = {
        user: { id: 'user_123' },
        ip: '1.2.3.4',
      };

      expect(userKeyGenerator(req)).toBe('user:user_123');
    });

    it('uses uid when user id is unavailable', () => {
      const req = {
        user: { uid: 'firebase_uid_123' },
        ip: '1.2.3.4',
      };

      expect(userKeyGenerator(req)).toBe('uid:firebase_uid_123');
    });

    it('falls back to the IP address when no user identity is available', () => {
      const req = {
        ip: '1.2.3.4',
      };

      expect(userKeyGenerator(req)).toBe('1.2.3.4');
    });
  });

  describe('isSuspiciousForwardedHeader', () => {
    it('detects malformed forwarded headers', () => {
  expect(
    isSuspiciousForwardedHeader('203.0.113.10,,10.0.0.1'),
  ).toBe(true);

  expect(
    isSuspiciousForwardedHeader('203.0.113.10\n10.0.0.1'),
  ).toBe(true);

  expect(
    isSuspiciousForwardedHeader('203.0.113.10\r10.0.0.1'),
  ).toBe(true);
});

    it('accepts a normal forwarded header', () => {
      expect(
        isSuspiciousForwardedHeader('203.0.113.10, 10.0.0.1'),
      ).toBe(false);
    });
  });

  it('creates a deferred Redis store', () => {
    const store = createStore('rl:test:');

    expect(store).toBeInstanceOf(__testing.DeferredRedisStore);
    expect(typeof store.increment).toBe('function');
    expect(typeof store.decrement).toBe('function');
    expect(typeof store.resetKey).toBe('function');
    expect(typeof store.resetAll).toBe('function');
    expect(typeof store.get).toBe('function');
  });

  it('uses the memory store when Redis is unavailable', async () => {
    const store = createStore('rl:test:');

    store.init({
      windowMs: 60_000,
      limit: 5,
    });

    const result = await store.increment('client-1');

    expect(result).toEqual(
      expect.objectContaining({
        totalHits: expect.any(Number),
      }),
    );
  });

  it('globalLimiter skips /health requests', async () => {
    const req = {
      path: '/health',
      ip: '127.0.0.1',
      headers: {},
      method: 'GET',
    };

    const next = vi.fn();

    const res = {
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      removeHeader: vi.fn(),
      status: vi.fn(),
      send: vi.fn(),
      end: vi.fn(),
    };

    await globalLimiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});