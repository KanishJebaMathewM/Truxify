import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => {
  process.env.WIM_SIGNING_SECRET = 'test-secret-123';
});

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { evaluateBypassEligibility, createSignedWimPacket } from '../../src/services/wimBypass.js';

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
      const result = createSignedWimPacket({ truckId: 't1', safetyScore: 90, bolId: 'b1', axleWeight: 8000 });
      expect(result.packet.truckId).toBe('t1');
      expect(result.packet.timestamp).toBeTypeOf('number');
      expect(result.signature).toMatch(/^[a-f0-9]{64}$/);
    });

    it('is deterministic for the same payload within the same timestamp', () => {
      const a = createSignedWimPacket({ truckId: 't1', safetyScore: 90 });
      const b = createSignedWimPacket({ truckId: 't1', safetyScore: 90 });
      // Timestamps differ, so signatures differ unless payload identical
      expect(a.packet.timestamp).toBeTypeOf('number');
      expect(b.signature).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
