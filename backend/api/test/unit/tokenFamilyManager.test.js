import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerTokenFamily,
  verifyAndRotateFamily,
  revokeTokenFamily,
  isFamilyRevoked,
  generateFamilyId,
  clearTokenFamilyStore,
} from '../../src/security/tokenFamilyManager.js';

describe('TokenFamilyManager Unit Tests', () => {
  beforeEach(() => {
    clearTokenFamilyStore();
  });

  it('generates unique UUID family IDs', () => {
    const id1 = generateFamilyId();
    const id2 = generateFamilyId();
    expect(id1).not.toBe(id2);
    expect(typeof id1).toBe('string');
  });

  it('registers a new token family and allows valid sequential rotations', () => {
    const familyId = 'family-uuid-1';
    registerTokenFamily(familyId, 0);

    // Initial rotation: gen 0 -> gen 1
    const rot1 = verifyAndRotateFamily(familyId, 0);
    expect(rot1.valid).toBe(true);
    expect(rot1.nextGen).toBe(1);

    // Subsequent rotation: gen 1 -> gen 2
    const rot2 = verifyAndRotateFamily(familyId, 1);
    expect(rot2.valid).toBe(true);
    expect(rot2.nextGen).toBe(2);
  });

  it('detects replay attack (token reuse with older gen) and revokes family', () => {
    const familyId = 'family-uuid-replay';
    registerTokenFamily(familyId, 0);

    // Rotate to gen 1
    verifyAndRotateFamily(familyId, 0);

    // Replay attack: Attacker tries to reuse original token with gen 0
    const attackRot = verifyAndRotateFamily(familyId, 0);
    expect(attackRot.valid).toBe(false);
    expect(attackRot.error).toContain('Token family reuse detected');
    expect(isFamilyRevoked(familyId)).toBe(true);

    // Subsequent request with valid gen 1 should now be rejected because family is revoked
    const legRot = verifyAndRotateFamily(familyId, 1);
    expect(legRot.valid).toBe(false);
    expect(legRot.error).toContain('revoked');
  });

  it('allows explicit token family revocation', () => {
    const familyId = 'family-uuid-explicit';
    registerTokenFamily(familyId, 0);

    revokeTokenFamily(familyId, 'USER_LOGOUT');
    expect(isFamilyRevoked(familyId)).toBe(true);

    const rot = verifyAndRotateFamily(familyId, 0);
    expect(rot.valid).toBe(false);
  });
});
