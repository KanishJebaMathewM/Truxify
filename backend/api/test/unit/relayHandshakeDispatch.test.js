import { describe, expect, it } from 'vitest';
import crypto from 'crypto';
import {
  generateHandshakeToken,
  verifyHubGeofence,
  verifyRelayHandshake,
} from '../../src/services/relayHandshakeService.js';
import {
  calculateDistanceKm,
  findNearestHub,
  TRANSSHIPMENT_HUBS,
} from '../../src/services/relayDispatchService.js';

const SECRET = 'test-relay-handshake-secret-0123456789abcdef';
process.env.RELAY_HANDSHAKE_SECRET = SECRET;

const buildVerification = (token, overrides = {}) => ({
  relayBookingId: token.relayBookingId,
  legIndex: token.legIndex,
  inboundDriverId: token.inboundDriverId,
  outboundDriverId: 'driver-out-1',
  hubId: token.hubId,
  tokenTimestamp: token.timestamp,
  nonce: token.nonce,
  signature: token.signature,
  submittedInboundOtp: token.inboundOtp,
  submittedOutboundOtp: token.outboundOtp,
  expectedInboundOtp: token.inboundOtp,
  expectedOutboundOtp: token.outboundOtp,
  inboundGps: { lat: 28.7511, lng: 77.1472 },
  outboundGps: { lat: 28.7511, lng: 77.1472 },
  ...overrides,
});

describe('relayHandshakeService.generateHandshakeToken', () => {
  it('produces a signed token with dual OTPs and a 10-minute expiry', () => {
    const t = generateHandshakeToken('RB-1', 0, 'driver-in-1', 'HUB_DEL_01');
    expect(t.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(t.inboundOtp).toMatch(/^\d{6}$/);
    expect(t.outboundOtp).toMatch(/^\d{6}$/);
    expect(t.expiresAt - t.timestamp).toBe(600);
  });

  it('nonce + OTPs are random per token', () => {
    const a = generateHandshakeToken('RB-1', 0, 'd', 'HUB_DEL_01');
    const b = generateHandshakeToken('RB-1', 0, 'd', 'HUB_DEL_01');
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.signature).not.toBe(b.signature);
  });
});

describe('relayHandshakeService.verifyRelayHandshake', () => {
  it('a freshly generated token verifies', async () => {
    const t = generateHandshakeToken('RB-7', 1, 'driver-in-1', 'HUB_DEL_01');
    const res = await verifyRelayHandshake(buildVerification(t));
    expect(res.success ?? true).toBeTruthy();
  });

  it('rejects an expired token (TTL)', async () => {
    const t = generateHandshakeToken('RB-7', 1, 'driver-in-1', 'HUB_DEL_01');
    await expect(verifyRelayHandshake(buildVerification(t, { tokenTimestamp: t.timestamp - 601 })))
      .rejects.toThrow(/expired/);
  });

  it('rejects a tampered signature', async () => {
    const t = generateHandshakeToken('RB-7', 1, 'driver-in-1', 'HUB_DEL_01');
    await expect(verifyRelayHandshake(buildVerification(t, { signature: '00'.repeat(32) })))
      .rejects.toThrow(/signature/);
  });

  it('rejects OTP mismatch', async () => {
    const t = generateHandshakeToken('RB-7', 1, 'driver-in-1', 'HUB_DEL_01');
    await expect(verifyRelayHandshake(buildVerification(t, { submittedInboundOtp: '000000' })))
      .rejects.toThrow(/OTP mismatch/);
  });

  it('rejects when the inbound driver is outside the hub geofence', async () => {
    const t = generateHandshakeToken('RB-7', 1, 'driver-in-1', 'HUB_DEL_01');
    await expect(verifyRelayHandshake(buildVerification(t, {
      inboundGps: { lat: 19.076, lng: 72.8777 },  // Mumbai — far from Delhi hub
      outboundGps: { lat: 28.7511, lng: 77.1472 },
    }))).rejects.toThrow(/outside hub geofence/);
  });

  it('signature binds the exact payload fields (hub swap fails)', async () => {
    const t = generateHandshakeToken('RB-7', 1, 'driver-in-1', 'HUB_DEL_01');
    await expect(verifyRelayHandshake(buildVerification(t, { hubId: 'HUB_NGP_01' })))
      .rejects.toThrow(/signature/);
  });

  it('rejects a hand-off when either driver has no GPS telemetry', async () => {
    const t = generateHandshakeToken('RB-7', 1, 'driver-in-1', 'HUB_DEL_01');
    await expect(verifyRelayHandshake(buildVerification(t, { outboundGps: null })))
      .rejects.toThrow(/Both drivers must provide GPS/);
  });

  it('rejects a substituted outbound OTP because both OTPs are signed', async () => {
    const t = generateHandshakeToken('RB-7', 1, 'driver-in-1', 'HUB_DEL_01');
    await expect(verifyRelayHandshake(buildVerification(t, {
      expectedOutboundOtp: '000000',
      submittedOutboundOtp: '000000',
    }))).rejects.toThrow(/signature/);
  });

  it('rejects generation when the handshake secret is missing', () => {
    const saved = process.env.RELAY_HANDSHAKE_SECRET;
    delete process.env.RELAY_HANDSHAKE_SECRET;
    try {
      expect(() => generateHandshakeToken('RB-7', 1, 'driver-in-1', 'HUB_DEL_01'))
        .toThrow(/RELAY_HANDSHAKE_SECRET/);
    } finally {
      process.env.RELAY_HANDSHAKE_SECRET = saved;
    }
  });
});

describe('relayHandshakeService.verifyHubGeofence', () => {
  it('inside radius passes, outside fails with distance detail', () => {
    const inside = verifyHubGeofence(28.7511, 77.1472, 'HUB_DEL_01');
    expect(inside.isWithinGeofence).toBe(true);
    expect(inside.distanceMeters).toBe(0);

    const outside = verifyHubGeofence(28.9, 77.3, 'HUB_DEL_01');
    expect(outside.isWithinGeofence).toBe(false);
    expect(outside.maxAllowedRadiusMeters).toBe(1500);
    expect(outside.distanceMeters).toBeGreaterThan(1500);
  });

  it('unknown hub ids fail closed instead of skipping the geofence', () => {
    const result = verifyHubGeofence(0, 0, 'CUSTOM_HUB');
    expect(result.isWithinGeofence).toBe(false);
    expect(result.reason).toBe('UNKNOWN_HUB');
  });
});

describe('relayDispatchService hub math', () => {
  it('calculateDistanceKm: Delhi↔Mumbai ≈ 1150km, self = 0', () => {
    expect(calculateDistanceKm(28.6139, 77.209, 28.6139, 77.209)).toBeCloseTo(0, 5);
    const d = calculateDistanceKm(28.6139, 77.209, 19.076, 72.8777);
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1200);
  });

  it('findNearestHub picks the closest registered hub within radius', () => {
    const near = findNearestHub(28.75, 77.15);
    expect(near.id).toBe('HUB_DEL_01');
    expect(near.distanceToPointKm).toBeLessThan(5);
  });

  it('findNearestHub returns null beyond the search radius', () => {
    expect(findNearestHub(15.0, 75.0, 50)).toBeNull(); // far from all NH44 hubs
  });

  it('hub registry integrity: unique ids, valid coordinates, positive radii', () => {
    const ids = new Set();
    for (const h of TRANSSHIPMENT_HUBS) {
      expect(ids.has(h.id)).toBe(false);
      ids.add(h.id);
      expect(h.lat).toBeGreaterThan(6);
      expect(h.lat).toBeLessThan(38);
      expect(h.radiusMeters).toBeGreaterThan(0);
    }
  });
});
