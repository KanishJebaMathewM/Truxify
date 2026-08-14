import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nodeCrypto from 'crypto';

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: m.supabase,
  supabase: m.supabase,
  firebaseAdmin: null,
  redisClient: null,
  createUserClient: () => m.supabase,
}));

const TEST_SECRET = 'test-wim-signing-secret-0123456789abcdef-0123456789abcdef';

beforeEach(() => {
  process.env.WIM_SIGNING_SECRET = TEST_SECRET;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const {
  canonicalStringify,
  evaluateBypassEligibility,
  buildTrustedMeasurement,
  validateTrustedMeasurement,
  createSignedWimPacket,
  verifyWimPacket,
  buildCredential,
  MIN_SAFETY_SCORE,
  WIM_PACKET_VERSION,
  WIM_MEASUREMENT_SOURCE,
} = await import('../../src/services/wimBypass.js');

describe('WIM bypass — canonical serialization', () => {
  it('serializes objects identically regardless of key insertion order', () => {
    const a = { b: 1, a: 'x', c: { z: true, y: [1, 2] } };
    const b = { c: { y: [1, 2], z: true }, a: 'x', b: 1 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it('canonical output is deterministic for nested structures', () => {
    const value = { eligibility: true, issuedAt: 123, expiresAt: 456 };
    expect(canonicalStringify(value)).toBe(
      '{"eligibility":true,"expiresAt":456,"issuedAt":123}',
    );
  });
});

describe('WIM bypass — eligibility', () => {
  it('allows safe, verified, non-overweight trucks', () => {
    expect(
      evaluateBypassEligibility({ safetyScore: 100, axleWeight: 34000, maxWeightLimit: 40000 }),
    ).toBe(true);
  });

  it('rejects low safety scores', () => {
    expect(
      evaluateBypassEligibility({ safetyScore: MIN_SAFETY_SCORE - 1, axleWeight: 100, maxWeightLimit: 40000 }),
    ).toBe(false);
  });

  it('rejects overweight loads', () => {
    expect(
      evaluateBypassEligibility({ safetyScore: 100, axleWeight: 41000, maxWeightLimit: 40000 }),
    ).toBe(false);
  });

  it('rejects non-numeric / non-finite inputs', () => {
    expect(evaluateBypassEligibility({ safetyScore: '100', axleWeight: 100, maxWeightLimit: 40000 })).toBe(false);
    expect(evaluateBypassEligibility({ safetyScore: NaN, axleWeight: 100, maxWeightLimit: 40000 })).toBe(false);
    expect(evaluateBypassEligibility({ safetyScore: Infinity, axleWeight: 100, maxWeightLimit: 40000 })).toBe(false);
    expect(evaluateBypassEligibility({ safetyScore: 100, axleWeight: Infinity, maxWeightLimit: 40000 })).toBe(false);
  });
});

describe('WIM bypass — trusted measurement', () => {
  const truck = { id: 'truck-A', driver_id: 'driver-1', max_capacity_tons: 20 };
  const order = { id: 'order-1', order_display_id: 'BOL-1', driver_id: 'driver-1', truck_id: 'truck-A', weight_tonnes: 15 };
  const verifiedProfile = { is_digilocker_verified: true };
  const unverifiedProfile = { is_digilocker_verified: false };

  it('derives weight/capacity/safety purely from server records', () => {
    const measurement = buildTrustedMeasurement({ truck, order, driverProfile: verifiedProfile });
    expect(measurement.weightLbs).toBe(30000);   // 15 tonnes * 2000
    expect(measurement.capacityLbs).toBe(40000); // 20 tonnes * 2000
    expect(measurement.safetyScore).toBe(100);
    expect(measurement.source).toBe(WIM_MEASUREMENT_SOURCE);
    expect(measurement.truckId).toBe('truck-A');
    expect(measurement.orderDisplayId).toBe('BOL-1');
  });

  it('fails the safety signal closed when the driver is not verified', () => {
    const measurement = buildTrustedMeasurement({ truck, order, driverProfile: unverifiedProfile });
    expect(measurement.safetyScore).toBe(0);
    expect(evaluateBypassEligibility({ safetyScore: measurement.safetyScore, axleWeight: measurement.weightLbs, maxWeightLimit: measurement.capacityLbs })).toBe(false);
  });

  it('fails the safety signal closed when the profile is missing', () => {
    const measurement = buildTrustedMeasurement({ truck, order, driverProfile: null });
    expect(measurement.safetyScore).toBe(0);
  });
});

describe('WIM bypass — measurement freshness & correlation', () => {
  const freshMeasurement = {
    truckId: 'truck-A',
    orderDisplayId: 'BOL-1',
    measuredAt: Date.now(),
    source: WIM_MEASUREMENT_SOURCE,
  };

  it('accepts a fresh, correctly-correlated measurement', () => {
    const result = validateTrustedMeasurement(freshMeasurement, {
      expectedTruckId: 'truck-A',
      expectedOrderDisplayId: 'BOL-1',
      maxAgeMs: 900000,
    });
    expect(result).toEqual({ valid: true, reason: null });
  });

  it('rejects a stale measurement', () => {
    const stale = { ...freshMeasurement, measuredAt: Date.now() - 901000 };
    const result = validateTrustedMeasurement(stale, {
      expectedTruckId: 'truck-A',
      expectedOrderDisplayId: 'BOL-1',
      maxAgeMs: 900000,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('stale-measurement');
  });

  it('rejects a measurement belonging to another vehicle', () => {
    const result = validateTrustedMeasurement(freshMeasurement, {
      expectedTruckId: 'truck-B',
      expectedOrderDisplayId: 'BOL-1',
      maxAgeMs: 900000,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('measurement-vehicle-mismatch');
  });

  it('rejects a measurement belonging to another load', () => {
    const result = validateTrustedMeasurement(freshMeasurement, {
      expectedTruckId: 'truck-A',
      expectedOrderDisplayId: 'BOL-2',
      maxAgeMs: 900000,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('measurement-load-mismatch');
  });

  it('rejects an untrusted measurement source', () => {
    const result = validateTrustedMeasurement({ ...freshMeasurement, source: 'client-supplied' }, {
      expectedTruckId: 'truck-A',
      expectedOrderDisplayId: 'BOL-1',
      maxAgeMs: 900000,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('untrusted-measurement-source');
  });

  it('rejects a missing measurement and invalid timestamps', () => {
    const missing = validateTrustedMeasurement(null, { expectedTruckId: 'truck-A', expectedOrderDisplayId: 'BOL-1', maxAgeMs: 900000 });
    expect(missing.reason).toBe('missing-measurement');

    const badTimestamp = validateTrustedMeasurement({ ...freshMeasurement, measuredAt: 'not-a-timestamp' }, {
      expectedTruckId: 'truck-A',
      expectedOrderDisplayId: 'BOL-1',
      maxAgeMs: 900000,
    });
    expect(badTimestamp.reason).toBe('invalid-measurement-timestamp');
  });
});

describe('WIM bypass — credential signing & verification', () => {
  const credential = {
    credentialId: 'cred-1',
    measurementId: 'measure-1',
    truckId: 'truck-A',
    orderDisplayId: 'BOL-1',
    driverId: 'driver-1',
    safetyScore: 100,
    axleWeightLbs: 30000,
    capacityLbs: 40000,
    eligible: true,
    issuedAt: Date.now() - 1000,
    expiresAt: Date.now() + 900000,
  };

  it('round-trips: signed packet verifies successfully', () => {
    const signed = createSignedWimPacket(credential);
    const result = verifyWimPacket(signed);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.packetData.credentialId).toBe('cred-1');
    expect(signed.packet.v).toBe(WIM_PACKET_VERSION);
  });

  it('produces a signature that is independent of JSON key order', () => {
    const signedA = createSignedWimPacket(credential);

    const reordered = {
      expiresAt: credential.expiresAt,
      eligibility: credential.eligible,
      safetyScore: credential.safetyScore,
      bolId: credential.orderDisplayId,
      maxWeightLimit: credential.capacityLbs,
      truckId: credential.truckId,
      timestamp: credential.issuedAt,
      issuedAt: credential.issuedAt,
      measurementId: credential.measurementId,
      axleWeight: credential.axleWeightLbs,
      credentialId: credential.credentialId,
      v: WIM_PACKET_VERSION,
    };
    const serialized = canonicalStringify(reordered);
    const signatureB = nodeCrypto.createHmac('sha256', TEST_SECRET).update(serialized, 'utf8').digest('hex');

    expect(signatureB).toBe(signedA.signature);
  });

  it('detects a modified payload', () => {
    const signed = createSignedWimPacket(credential);
    const tampered = {
      packet: { ...signed.packet, axleWeight: signed.packet.axleWeight + 1000 },
      signature: signed.signature,
    };
    const result = verifyWimPacket(tampered);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid-signature');
  });

  it('rejects a packet signed with the wrong secret', () => {
    const signed = createSignedWimPacket(credential);
    const result = verifyWimPacket(signed, { secret: 'a-completely-different-secret-aaaaaaaaaaaaaaaaaaaa' });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid-signature');
  });

  it('rejects an expired credential', () => {
    const expired = {
      ...credential,
      issuedAt: Date.now() - 1200000,
      expiresAt: Date.now() - 600000,
    };
    const signed = createSignedWimPacket(expired);
    const result = verifyWimPacket(signed);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expired-credential');
  });

  it('rejects a packet missing a credential id', () => {
    const packetData = { v: WIM_PACKET_VERSION, issuedAt: Date.now() - 1000, expiresAt: Date.now() + 1000 };
    const signature = nodeCrypto.createHmac('sha256', TEST_SECRET).update(canonicalStringify(packetData), 'utf8').digest('hex');
    const result = verifyWimPacket({ packet: packetData, signature });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing-credential-id');
  });

  it('rejects an unsupported packet version', () => {
    const packetData = {
      v: 1,
      credentialId: 'cred-1',
      measurementId: 'measure-1',
      truckId: 'truck-A',
      bolId: 'BOL-1',
      safetyScore: 100,
      axleWeight: 30000,
      maxWeightLimit: 40000,
      eligibility: true,
      timestamp: Date.now() - 1000,
      issuedAt: Date.now() - 1000,
      expiresAt: Date.now() + 1000,
    };
    const signature = nodeCrypto.createHmac('sha256', TEST_SECRET).update(canonicalStringify(packetData), 'utf8').digest('hex');
    const result = verifyWimPacket({ packet: packetData, signature });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('unsupported-version');
  });

  it('rejects malformed packets', () => {
    expect(verifyWimPacket(null).reason).toBe('malformed-packet');
    expect(verifyWimPacket({}).reason).toBe('malformed-packet');
    expect(verifyWimPacket({ packet: {}, signature: '' }).reason).toBe('malformed-packet');
  });
});

describe('WIM bypass — signing secret (fail closed)', () => {
  it('throws when the signing secret is missing', () => {
    vi.stubEnv('WIM_SIGNING_SECRET', '');
    expect(() => createSignedWimPacket({
      credentialId: 'cred-1', issuedAt: 1, expiresAt: 2,
    })).toThrow(/WIM_SIGNING_SECRET/);
  });

  it('verification reports signing-config-missing instead of verifying', () => {
    const signed = createSignedWimPacket({
      credentialId: 'c',
      measurementId: 'm',
      truckId: 't',
      orderDisplayId: 'b',
      safetyScore: 100,
      axleWeightLbs: 1,
      capacityLbs: 2,
      eligible: true,
      issuedAt: Date.now() - 1000,
      expiresAt: Date.now() + 1000,
    });
    vi.stubEnv('WIM_SIGNING_SECRET', '');
    const result = verifyWimPacket(signed);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('signing-config-missing');
  });

  it('rejects a too-short signing secret at configuration validation time', async () => {
    vi.stubEnv('WIM_SIGNING_SECRET', 'short-secret');
    const { validateWimConfig } = await import('../../src/config/wim.js');
    expect(() => validateWimConfig()).toThrow(/at least/);
  });
});

describe('WIM bypass — credential construction', () => {
  it('assigns a unique credential id and server-controlled expiry', () => {
    const measurement = {
      id: 'measure-1',
      truckId: 'truck-A',
      orderDisplayId: 'BOL-1',
      driverId: 'driver-1',
      safetyScore: 100,
      weightLbs: 30000,
    };
    const now = 1700000000000;
    const credential = buildCredential({ measurement, eligibility: true, now });

    expect(credential.credentialId).toBeTruthy();
    expect(credential.issuedAt).toBe(now);
    expect(credential.expiresAt).toBe(now + 15 * 60 * 1000);
    expect(credential.measurementId).toBe('measure-1');
    expect(credential.eligible).toBe(true);
  });

  it('generates distinct credential ids across issuances', () => {
    const measurement = { id: 'm', truckId: 't', orderDisplayId: 'b', driverId: 'd', safetyScore: 100, weightLbs: 1 };
    const a = buildCredential({ measurement, eligibility: true });
    const b = buildCredential({ measurement, eligibility: true });
    expect(a.credentialId).not.toBe(b.credentialId);
  });
});
