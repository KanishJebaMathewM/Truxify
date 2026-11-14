import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  CHALLENGE_TERMINAL_RETENTION_MS,
  MAX_BIOMETRIC_CHALLENGE_SESSIONS,
  createChallenge,
  getChallenge,
  pruneChallengeSessions,
} from '../../src/services/biometricAuthService.js';

describe('biometric challenge session bounds', () => {
  it('rejects challenge creation with a capacity error at the cap', () => {
    const challengeIds = [];

    for (let i = 0; i < MAX_BIOMETRIC_CHALLENGE_SESSIONS; i += 1) {
      challengeIds.push(createChallenge(`cap-user-${i}`, `cap-shipment-${i}`, 6_000_000).challengeId);
    }

    let capacityError;
    try {
      createChallenge('cap-user-overflow', 'cap-shipment-overflow', 6_000_000);
    } catch (error) {
      capacityError = error;
    }

    expect(capacityError).toBeDefined();
    expect(capacityError.statusCode).toBe(429);
    expect(capacityError.code).toBe('BIOMETRIC_CHALLENGE_CAPACITY');
    expect(capacityError.message).toContain(String(MAX_BIOMETRIC_CHALLENGE_SESSIONS));

    for (const challengeId of challengeIds) {
      getChallenge(challengeId).expiresAt = 0;
    }
    pruneChallengeSessions();
  });

  it('creates a normal challenge when capacity is available', () => {
    const challenge = createChallenge('normal-user', 'normal-shipment', 6_000_000);

    expect(challenge.challengeId).toMatch(/^[a-f0-9]{32}$/);
    expect(getChallenge(challenge.challengeId).status).toBe('pending');
  });

  it('prunes expired pending sessions before inserting a new challenge', () => {
    const stale = createChallenge('stale-user', 'stale-shipment', 6_000_000);
    getChallenge(stale.challengeId).expiresAt = Date.now() - 1;

    const fresh = createChallenge('fresh-user', 'fresh-shipment', 6_000_000);

    expect(getChallenge(stale.challengeId)).toBeUndefined();
    expect(getChallenge(fresh.challengeId)).toBeDefined();
  });

  it('retains verified sessions for the status window and then prunes them', () => {
    const verified = createChallenge('verified-user', 'verified-shipment', 6_000_000);
    const session = getChallenge(verified.challengeId);
    session.status = 'verified';
    session.verifiedAt = new Date().toISOString();

    const justVerified = Date.parse(session.verifiedAt) + 1_000;
    expect(pruneChallengeSessions(justVerified)).toBe(0);
    expect(getChallenge(verified.challengeId)).toBeDefined();

    const afterRetention = Date.parse(session.verifiedAt) + CHALLENGE_TERMINAL_RETENTION_MS + 1;
    expect(pruneChallengeSessions(afterRetention)).toBeGreaterThanOrEqual(1);
    expect(getChallenge(verified.challengeId)).toBeUndefined();
  });
});
