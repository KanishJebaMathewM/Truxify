import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

const sharedRedisNonces = new Map();

vi.mock('ioredis', () => ({
  default: class MockRedis {
    constructor() {}

    async set(key, value, nx, ex, ttl) {
      if (nx !== 'NX' || ex !== 'EX' || ttl !== 300) {
        throw new Error('Unexpected Redis SET arguments');
      }
      if (sharedRedisNonces.has(key)) {
        return null;
      }
      sharedRedisNonces.set(key, value);
      return 'OK';
    }
  },
}));

const configuredSecret = 'a'.repeat(64);
process.env.REDIS_URL = 'redis://mock-hmac-test';
process.env.NODE_ENV = 'test';
process.env.HMAC_SECRET = configuredSecret;

const serviceA = await import('../../src/services/hmacService.js?instance=A');
const serviceB = await import('../../src/services/hmacService.js?instance=B');

afterEach(() => {
  process.env.HMAC_SECRET = configuredSecret;
});

afterAll(() => {
  delete process.env.REDIS_URL;
});

describe('hmacService', () => {
  beforeEach(() => {
    sharedRedisNonces.clear();
  });

  describe('distributed and bounded nonce protection', () => {
    it('accepts a new nonce once and rejects the same nonce on another service instance', async () => {
      const nonce = `distributed-${Date.now()}-${Math.random()}`;
      expect(await serviceA.isNonceValid(nonce)).toBe(true);
      expect(await serviceB.isNonceValid(nonce)).toBe(false);
    });

    it('uses an atomic NX reservation with a five-minute expiration', async () => {
      const nonce = `ttl-${Date.now()}-${Math.random()}`;
      expect(await serviceA.isNonceValid(nonce)).toBe(true);
      expect(sharedRedisNonces.has(`truxify:hmac:nonce:${nonce}`)).toBe(true);
    });

    it('rejects empty, non-string, and oversized nonces', async () => {
      expect(await serviceA.isNonceValid('')).toBe(false);
      expect(await serviceA.isNonceValid(null)).toBe(false);
      expect(await serviceA.isNonceValid('x'.repeat(257))).toBe(false);
    });
  });

  describe('isTimestampValid', () => {
    it('accepts timestamps within the five-minute tolerance window', () => {
      const now = Date.now();
      expect(serviceA.isTimestampValid(now)).toBe(true);
      expect(serviceA.isTimestampValid(now - 2 * 60 * 1000)).toBe(true);
      expect(serviceA.isTimestampValid(now + 2 * 60 * 1000)).toBe(true);
    });

    it('rejects timestamps outside the five-minute tolerance window', () => {
      const now = Date.now();
      expect(serviceA.isTimestampValid(now - 6 * 60 * 1000)).toBe(false);
      expect(serviceA.isTimestampValid(now + 6 * 60 * 1000)).toBe(false);
    });

    it('handles numeric string timestamps safely', () => {
      expect(serviceA.isTimestampValid(String(Date.now()))).toBe(true);
    });
  });

  describe('secret configuration', () => {
    it('rejects a missing secret instead of using a hardcoded fallback', () => {
      delete process.env.HMAC_SECRET;
      expect(() => serviceA.generateSignature('payload', Date.now(), 'nonce')).toThrow(/HMAC_SECRET is required/);
    });

    it('rejects secrets shorter than the minimum length', () => {
      process.env.HMAC_SECRET = 'too-short';
      expect(() => serviceA.generateSignature('payload', Date.now(), 'nonce')).toThrow(/at least 32 bytes/);
    });

    it('fails closed during production startup when the secret is missing', async () => {
      const { execFileSync } = await import('node:child_process');
      expect(() => execFileSync(
        process.execPath,
        ['--input-type=module', '-e', "await import('./src/services/hmacService.js')"],
        {
          cwd: process.cwd(),
          env: { ...process.env, NODE_ENV: 'production', HMAC_SECRET: '' },
          stdio: 'pipe',
        }
      )).toThrow();
    });
  });

  describe('signature generation and verification', () => {
    it('generates a 64-character hex sha256 HMAC signature', () => {
      const payload = JSON.stringify({ amount: 500, bookingId: 'bk-123' });
      const timestamp = Date.now();
      const nonce = 'unique-nonce-1';
      const sig = serviceA.generateSignature(payload, timestamp, nonce);

      expect(typeof sig).toBe('string');
      expect(sig).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(sig)).toBe(true);
    });

    it('produces deterministic signatures for identical inputs', () => {
      const payload = 'order-payload';
      const timestamp = 1700000000000;
      const nonce = 'nonce-abc';
      expect(serviceA.generateSignature(payload, timestamp, nonce)).toBe(
        serviceA.generateSignature(payload, timestamp, nonce)
      );
    });

    it('returns true when the signature matches the payload, timestamp, and nonce', () => {
      const payload = 'payment-confirmation';
      const timestamp = Date.now();
      const nonce = 'nonce-xyz';
      const signature = serviceA.generateSignature(payload, timestamp, nonce);
      expect(serviceA.verifySignature(signature, payload, timestamp, nonce)).toBe(true);
    });

    it('returns false when the payload, timestamp, or nonce is altered', () => {
      const payload = 'escrow-lock';
      const timestamp = Date.now();
      const nonce = 'nonce-test';
      const signature = serviceA.generateSignature(payload, timestamp, nonce);

      expect(serviceA.verifySignature(signature, 'tampered-payload', timestamp, nonce)).toBe(false);
      expect(serviceA.verifySignature(signature, payload, timestamp + 100, nonce)).toBe(false);
      expect(serviceA.verifySignature(signature, payload, timestamp, 'wrong-nonce')).toBe(false);
    });

    it('returns false for malformed signatures without crashing', () => {
      const payload = 'data';
      const timestamp = Date.now();
      const nonce = 'nonce-1';
      expect(serviceA.verifySignature('invalid-sig', payload, timestamp, nonce)).toBe(false);
      expect(serviceA.verifySignature('', payload, timestamp, nonce)).toBe(false);
      expect(serviceA.verifySignature('123456', payload, timestamp, nonce)).toBe(false);
    });

    it('exports a default service object matching the named functions', async () => {
      const serviceC = await import('../../src/services/hmacService.js?instance=C');
      expect(serviceC.default.isNonceValid).toBe(serviceC.isNonceValid);
      expect(serviceC.default.isTimestampValid).toBe(serviceC.isTimestampValid);
      expect(serviceC.default.generateSignature).toBe(serviceC.generateSignature);
      expect(serviceC.default.verifySignature).toBe(serviceC.verifySignature);
    });
  });
});
