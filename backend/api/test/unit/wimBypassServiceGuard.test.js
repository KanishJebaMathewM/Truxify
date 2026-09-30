import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => {
  // At least 32 characters: shorter secrets are rejected by config/wim.js.
  process.env.WIM_SIGNING_SECRET = 'test-secret-123-0123456789abcdef0123';
});

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { evaluateBypassEligibility, createSignedWimPacket, buildCredential } from '../../src/services/wimBypass.js';

const credentialFor = (truckId) =>
  buildCredential({
    measurement: { id: 'm1', truckId, orderDisplayId: 'b1', driverId: 'd1', safetyScore: 90, weightLbs: 8000, capacityLbs: 10000 },
    eligibility: true,
  });

describe('wimBypass service', () => {
  describe('evaluateBypassEligibility', () => {
    it('returns true for eligible trucks', () => {
      expect(evaluateBypassEligibility({ safetyScore: 90, axleWeight: 8000, maxWeightLimit: 10000 })).toBe(true);
    });

    it('returns false when safetyScore is below 80', () => {
      expect(evaluateBypassEligibility({ safetyScore: 70, axleWeight: 8000, maxWeightLimit: 10000 })).toBe(false);
    });

    it('returns false when safetyScore is not a number', () => {
      expect(evaluateBypassEligibility({ safetyScore: 'high', axleWeight: 8000, maxWeightLimit: 10000 })).toBe(false);
    });

    it('returns false when axleWeight exceeds the limit', () => {
      expect(evaluateBypassEligibility({ safetyScore: 90, axleWeight: 12000, maxWeightLimit: 10000 })).toBe(false);
    });

    it('returns false when axleWeight is not a number', () => {
      expect(evaluateBypassEligibility({ safetyScore: 90, axleWeight: 'heavy', maxWeightLimit: 10000 })).toBe(false);
    });

    it('returns true when axleWeight equals the limit', () => {
      expect(evaluateBypassEligibility({ safetyScore: 90, axleWeight: 10000, maxWeightLimit: 10000 })).toBe(true);
    });
  });

  describe('createSignedWimPacket', () => {
    it('returns a packet with a timestamp and HMAC signature', () => {
      const result = createSignedWimPacket(credentialFor('t1'));
      expect(result.packet.truckId).toBe('t1');
      expect(result.packet.timestamp).toBeTypeOf('number');
      expect(result.signature).toMatch(/^[a-f0-9]{64}$/);
    });

    it('is deterministic for the same credential', () => {
      const credential = credentialFor('t1');
      const a = createSignedWimPacket(credential);
      const b = createSignedWimPacket(credential);
      expect(a.signature).toBe(b.signature);
      expect(a.packet.timestamp).toBeTypeOf('number');
      expect(b.signature).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
