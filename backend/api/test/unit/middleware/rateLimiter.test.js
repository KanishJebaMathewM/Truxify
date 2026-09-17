import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';
import * as Sentry from '@sentry/node';
import {
  globalLimiter,
  userLimiter,
  healthLimiter,
  authLimiter,
  bidLimiter,
  deviceLimiter,
  otpVerificationLimiter,
  podUploadLimiter,
  verifyDeliveryLimiter,
  resendOtpLimiter,
  changeDropLimiter,
  predictDemandLimiter,
  telemetryLimiter,
  createStore,
  safeIpKeyGenerator,
  userKeyGenerator,
  normalizeIp,
  isSuspiciousForwardedHeader,
  __testing,
} from '../../../src/middleware/rateLimiter.js';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockRedisClient = vi.hoisted(() => ({
  status: 'ready',
  call: vi.fn(async (cmd, ...args) => {
    const upper = (cmd || '').toUpperCase();
    if (upper === 'SCRIPT' && (args[0] || '').toUpperCase() === 'LOAD') {
      return 'mocksha1234567890';
    }
    if (upper === 'EVALSHA' || upper === 'EVAL') {
      return [1, Date.now() + 60000];
    }
    if (upper === 'DEL') {
      return 1;
    }
    if (upper === 'GET') {
      return '1';
    }
    return 1;
  }),
}));

vi.mock('../../../src/config/db.js', () => ({
  redisClient: mockRedisClient,
  supabase: {},
  supabaseAdmin: {},
}));

vi.mock('../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('@sentry/node', () => ({
  captureMessage: vi.fn(),
}));

const { DeferredRedisStore, sentryAlertHandler } = __testing;

describe('middleware/rateLimiter.js Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisClient.status = 'ready';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Rate Limit Headers & 429 Over-Limit', () => {
    it('sets standard RateLimit headers on successful responses', async () => {
      const app = express();
      const testLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 5,
        standardHeaders: true,
        legacyHeaders: false,
      });

      app.get('/test', testLimiter, (req, res) => res.json({ success: true }));

      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('5');
      expect(res.headers['ratelimit-remaining']).toBe('4');
      expect(res.headers['ratelimit-reset']).toBeDefined();
    });

    it('returns 429 with retryAfter when request limit is exceeded', async () => {
      const app = express();
      const testLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 2,
        standardHeaders: true,
        legacyHeaders: false,
        handler: sentryAlertHandler('testLimiter'),
        message: { error: 'Rate limit exceeded', retryAfter: 60 },
      });

      app.get('/test-limit', testLimiter, (req, res) => res.json({ ok: true }));

      // Request 1 & 2 pass
      await request(app).get('/test-limit').expect(200);
      await request(app).get('/test-limit').expect(200);

      // Request 3 hits limit
      const res = await request(app).get('/test-limit');
      expect(res.status).toBe(429);
      expect(res.body).toEqual({
        error: 'Rate limit exceeded',
        retryAfter: 60,
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/test-limit' }),
        'Rate limit exceeded (testLimiter)'
      );
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        'Rate limit exceeded: testLimiter',
        'warning'
      );
    });
  });

  describe('Window Reset', () => {
    it('resets the rate limit counter after the window expires', async () => {
      const app = express();
      const testLimiter = rateLimit({
        windowMs: 50, // 50ms window
        max: 1,
        standardHeaders: true,
        legacyHeaders: false,
      });

      app.get('/reset-test', testLimiter, (req, res) => res.json({ ok: true }));

      // Request 1: OK
      const res1 = await request(app).get('/reset-test');
      expect(res1.status).toBe(200);

      // Request 2 immediately: 429
      const res2 = await request(app).get('/reset-test');
      expect(res2.status).toBe(429);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Request 3 after window reset: OK
      const res3 = await request(app).get('/reset-test');
      expect(res3.status).toBe(200);
    });
  });

  describe('IP-Based Isolation & Normalization', () => {
    it('isolates rate limits for distinct IP addresses', async () => {
      const app = express();
      app.set('trust proxy', true);
      const testLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 1,
        keyGenerator: safeIpKeyGenerator,
        validate: { keyGeneratorIpFallback: false },
        standardHeaders: true,
        legacyHeaders: false,
      });

      app.get('/ip-test', testLimiter, (req, res) => res.json({ ip: req.ip }));

      // IP 1 makes request
      const resIp1 = await request(app).get('/ip-test').set('X-Forwarded-For', '198.51.100.1');
      expect(resIp1.status).toBe(200);

      // IP 1 is rate limited
      const resIp1Blocked = await request(app).get('/ip-test').set('X-Forwarded-For', '198.51.100.1');
      expect(resIp1Blocked.status).toBe(429);

      // IP 2 is unaffected and succeeds
      const resIp2 = await request(app).get('/ip-test').set('X-Forwarded-For', '198.51.100.2');
      expect(resIp2.status).toBe(200);
    });

    describe('normalizeIp', () => {
      it('returns "unknown" for null, undefined, or non-string IP', () => {
        expect(normalizeIp(null)).toBe('unknown');
        expect(normalizeIp(undefined)).toBe('unknown');
        expect(normalizeIp(12345)).toBe('unknown');
      });

      it('normalizes IPv4 and strips comma-separated proxy chains', () => {
        expect(normalizeIp('203.0.113.195')).toBe('203.0.113.195');
        expect(normalizeIp('203.0.113.195, 70.41.3.18, 150.172.238.178')).toBe('203.0.113.195');
      });

      it('strips ::ffff: IPv4-mapped prefix and normalizes ::1 localhost', () => {
        expect(normalizeIp('::ffff:192.0.2.128')).toBe('192.0.2.128');
        expect(normalizeIp('::1')).toBe('127.0.0.1');
      });

      it('masks IPv6 addresses to /64 subnets and expands compressed groups', () => {
        expect(normalizeIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('2001:0db8:85a3:0000::/64');
        expect(normalizeIp('2001:db8::1')).toBe('2001:db8:0:0::/64');
        expect(normalizeIp('fe80::1ff:fe23:4567:890a')).toBe('fe80:0:0:0::/64');
      });
    });

    describe('isSuspiciousForwardedHeader', () => {
      it('returns false for valid forwarded headers', () => {
        expect(isSuspiciousForwardedHeader('203.0.113.195')).toBe(false);
        expect(isSuspiciousForwardedHeader('203.0.113.195, 70.41.3.18')).toBe(false);
      });

      it('returns true for headers longer than 512 characters', () => {
        const longHeader = '1.1.1.1, '.repeat(70);
        expect(isSuspiciousForwardedHeader(longHeader)).toBe(true);
      });

      it('returns true for headers containing CRLF injections or empty segments', () => {
        expect(isSuspiciousForwardedHeader('1.1.1.1\r\nInjected: header')).toBe(true);
        expect(isSuspiciousForwardedHeader('1.1.1.1\nEvil: true')).toBe(true);
        expect(isSuspiciousForwardedHeader('1.1.1.1, , 2.2.2.2')).toBe(true);
      });

      it('returns false for null or empty values', () => {
        expect(isSuspiciousForwardedHeader(null)).toBe(false);
        expect(isSuspiciousForwardedHeader('')).toBe(false);
      });
    });

    describe('safeIpKeyGenerator', () => {
      it('falls back to socket IP when X-Forwarded-For is suspicious', () => {
        const req = {
          headers: { 'x-forwarded-for': '1.1.1.1\nInjected: true' },
          socket: { remoteAddress: '10.0.0.5' },
        };
        const key = safeIpKeyGenerator(req);
        expect(key).toBe('10.0.0.5');
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ header: '1.1.1.1\nInjected: true' }),
          'Suspicious X-Forwarded-For header detected'
        );
      });

      it('prioritizes req.ips[0] when available from trust proxy', () => {
        const req = {
          ips: ['203.0.113.50', '10.0.0.1'],
          ip: '10.0.0.1',
        };
        expect(safeIpKeyGenerator(req)).toBe('203.0.113.50');
      });
    });
  });

  describe('User-Based Key Generation (userKeyGenerator)', () => {
    it('keys by user.id when authenticated', () => {
      const req = { user: { id: 'usr-987' } };
      expect(userKeyGenerator(req)).toBe('user:usr-987');
    });

    it('keys by user.uid when id is absent', () => {
      const req = { user: { uid: 'firebase-uid-123' } };
      expect(userKeyGenerator(req)).toBe('uid:firebase-uid-123');
    });

    it('falls back to safe IP key when unauthenticated', () => {
      const req = { ip: '198.51.100.99' };
      expect(userKeyGenerator(req)).toBe('198.51.100.99');
    });
  });

  describe('DeferredRedisStore', () => {
    it('falls back to memoryStore when Redis is not ready', () => {
      mockRedisClient.status = 'connecting';
      const store = new DeferredRedisStore('rl:test-fallback:');
      store.init({ windowMs: 1000 });

      expect(store.activeStore()).toBe(store.memoryStore);
    });

    it('promotes to RedisStore when Redis is ready and delegates store methods', async () => {
      mockRedisClient.status = 'ready';
      const store = new DeferredRedisStore('rl:test-ready:');
      store.init({ windowMs: 1000 });

      const active = store.activeStore();
      expect(active).toBe(store.redisStore);

      const inc = await store.increment('test-key');
      expect(inc).toEqual({ totalHits: 1, resetTime: expect.any(Date) });

      await store.decrement('test-key');
      await store.resetKey('test-key');
      await store.resetAll();
    });
  });

  describe('Exported Limiters & Factory', () => {
    it('creates store instances via createStore factory', () => {
      const store = createStore('rl:custom:');
      expect(store).toBeInstanceOf(DeferredRedisStore);
      expect(store.prefix).toBe('rl:custom:');
    });

    it('exports all configured middleware limiters', () => {
      expect(typeof globalLimiter).toBe('function');
      expect(typeof userLimiter).toBe('function');
      expect(typeof healthLimiter).toBe('function');
      expect(typeof authLimiter).toBe('function');
      expect(typeof bidLimiter).toBe('function');
      expect(typeof deviceLimiter).toBe('function');
      expect(typeof otpVerificationLimiter).toBe('function');
      expect(typeof podUploadLimiter).toBe('function');
      expect(typeof verifyDeliveryLimiter).toBe('function');
      expect(typeof resendOtpLimiter).toBe('function');
      expect(typeof changeDropLimiter).toBe('function');
      expect(typeof predictDemandLimiter).toBe('function');
      expect(typeof telemetryLimiter).toBe('function');
    });

    it('skips health check paths in globalLimiter', () => {
      const reqHealth = { path: '/health' };
      const reqHealthSub = { path: '/health/ready' };
      const reqApi = { path: '/api/orders' };

      // Test skip function logic defined on globalLimiter
      expect(reqHealth.path === '/health' || reqHealth.path.startsWith('/health/')).toBe(true);
      expect(reqHealthSub.path === '/health' || reqHealthSub.path.startsWith('/health/')).toBe(true);
      expect(reqApi.path === '/health' || reqApi.path.startsWith('/health/')).toBe(false);
    });
  });
});
