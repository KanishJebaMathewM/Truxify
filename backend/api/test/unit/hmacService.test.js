import { describe, it, expect } from 'vitest';
import hmacService, {
  isNonceValid,
  isTimestampValid,
  generateSignature,
  verifySignature,
} from '../../src/services/hmacService.js';

describe('hmacService', () => {
  describe('isNonceValid', () => {
    it('accepts a new unique nonce and rejects replay with the same nonce', () => {
      const nonce = `test-nonce-${Date.now()}-${Math.random()}`;
      expect(isNonceValid(nonce)).toBe(true);
      expect(isNonceValid(nonce)).toBe(false);
    });
  });

  describe('isTimestampValid', () => {
    it('accepts timestamps within the 5-minute tolerance window', () => {
      const now = Date.now();
      expect(isTimestampValid(now)).toBe(true);
      expect(isTimestampValid(now - 2 * 60 * 1000)).toBe(true); // 2 mins ago
      expect(isTimestampValid(now + 2 * 60 * 1000)).toBe(true); // 2 mins future
    });

    it('rejects timestamps older than 5 minutes or too far in the future', () => {
      const now = Date.now();
      expect(isTimestampValid(now - 6 * 60 * 1000)).toBe(false); // 6 mins ago
      expect(isTimestampValid(now + 6 * 60 * 1000)).toBe(false); // 6 mins future
    });

    it('handles numeric string timestamps safely', () => {
      const nowStr = String(Date.now());
      expect(isTimestampValid(nowStr)).toBe(true);
    });
  });

  describe('generateSignature', () => {
    it('generates a 64-character hex sha256 HMAC signature', () => {
      const payload = JSON.stringify({ amount: 500, bookingId: 'bk-123' });
      const timestamp = Date.now();
      const nonce = 'unique-nonce-1';
      const sig = generateSignature(payload, timestamp, nonce);

      expect(typeof sig).toBe('string');
      expect(sig).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(sig)).toBe(true);
    });

    it('produces deterministic signatures for identical inputs', () => {
      const payload = 'order-payload';
      const timestamp = 1700000000000;
      const nonce = 'nonce-abc';
      const sig1 = generateSignature(payload, timestamp, nonce);
      const sig2 = generateSignature(payload, timestamp, nonce);

      expect(sig1).toBe(sig2);
    });
  });

  describe('verifySignature', () => {
    it('returns true when the signature matches the payload, timestamp, and nonce', () => {
      const payload = 'payment-confirmation';
      const timestamp = Date.now();
      const nonce = 'nonce-xyz';
      const signature = generateSignature(payload, timestamp, nonce);

      expect(verifySignature(signature, payload, timestamp, nonce)).toBe(true);
    });

    it('returns false when the payload is tampered', () => {
      const payload = 'payment-confirmation';
      const timestamp = Date.now();
      const nonce = 'nonce-xyz';
      const signature = generateSignature(payload, timestamp, nonce);

      expect(verifySignature(signature, 'tampered-payload', timestamp, nonce)).toBe(false);
    });

    it('returns false when the timestamp or nonce is altered', () => {
      const payload = 'escrow-lock';
      const timestamp = Date.now();
      const nonce = 'nonce-test';
      const signature = generateSignature(payload, timestamp, nonce);

      expect(verifySignature(signature, payload, timestamp + 100, nonce)).toBe(false);
      expect(verifySignature(signature, payload, timestamp, 'wrong-nonce')).toBe(false);
    });

    it('returns false when signature length or encoding is malformed without crashing', () => {
      const payload = 'data';
      const timestamp = Date.now();
      const nonce = 'nonce-1';

      expect(verifySignature('invalid-sig', payload, timestamp, nonce)).toBe(false);
      expect(verifySignature('', payload, timestamp, nonce)).toBe(false);
      expect(verifySignature('123456', payload, timestamp, nonce)).toBe(false);
    });

    it('exports default service object matching named functions', () => {
      expect(hmacService.isNonceValid).toBe(isNonceValid);
      expect(hmacService.isTimestampValid).toBe(isTimestampValid);
      expect(hmacService.generateSignature).toBe(generateSignature);
      expect(hmacService.verifySignature).toBe(verifySignature);
    });
  });
});
