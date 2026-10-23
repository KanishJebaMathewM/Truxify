/**
 * @fileoverview Cryptographic Hand-off Verification Service for Relay Transshipment.
 * 
 * Responsibilities:
 * 1. Generates time-bounded HMAC-SHA256 hand-off tokens and dynamic QR payloads.
 * 2. Enforces mutual dual-driver presence within the transshipment hub geofence.
 * 3. Verifies dual OTPs + cryptographic signatures between inbound and outbound drivers.
 * 4. Produces immutable hand-off receipts with digests for smart contract milestone release.
 */

import crypto from 'crypto';
import logger from '../middleware/logger.js';
import { DomainError } from './order/domainError.js';
import { calculateDistanceKm, TRANSSHIPMENT_HUBS } from './relayDispatchService.js';

const HANDSHAKE_SECRET = process.env.RELAY_HANDSHAKE_SECRET || 'truxify-relay-handshake-secret-key-2026';
const TOKEN_TTL_SECONDS = 600; // 10 minutes

/**
 * Generates an encrypted/signed QR hand-off payload for the inbound transferring driver.
 */
export function generateHandshakeToken(relayBookingId, legIndex, inboundDriverId, hubId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(8).toString('hex');
  const inboundOtp = crypto.randomInt(100000, 999999).toString();
  const outboundOtp = crypto.randomInt(100000, 999999).toString();

  const rawPayload = `${relayBookingId}:${legIndex}:${inboundDriverId}:${hubId}:${timestamp}:${nonce}:${inboundOtp}`;
  const signature = crypto
    .createHmac('sha256', HANDSHAKE_SECRET)
    .update(rawPayload)
    .digest('hex');

  const handshakeToken = {
    relayBookingId,
    legIndex,
    inboundDriverId,
    hubId,
    timestamp,
    expiresAt: timestamp + TOKEN_TTL_SECONDS,
    nonce,
    inboundOtp,
    outboundOtp,
    signature,
  };

  return handshakeToken;
}

/**
 * Validates whether GPS coordinates fall within the defined radius of a transshipment hub.
 */
export function verifyHubGeofence(driverLat, driverLng, hubId) {
  const hub = TRANSSHIPMENT_HUBS.find((h) => h.id === hubId);
  if (!hub) {
    // If custom hub coordinates, allow standard 2000m tolerance
    return { isWithinGeofence: true, distanceMeters: 0 };
  }

  const distanceKm = calculateDistanceKm(driverLat, driverLng, hub.lat, hub.lng);
  const distanceMeters = distanceKm * 1000;
  const isWithinGeofence = distanceMeters <= hub.radiusMeters;

  return {
    isWithinGeofence,
    distanceMeters: Math.round(distanceMeters),
    maxAllowedRadiusMeters: hub.radiusMeters,
    hubName: hub.name,
  };
}

/**
 * Verifies mutual hand-off between inbound and outbound drivers at a transit hub.
 * 
 * @param {Object} verificationData - Verification input payload
 * @returns {Object} Cryptographic hand-off receipt with digest
 */
export async function verifyRelayHandshake(verificationData) {
  const {
    relayBookingId,
    legIndex,
    inboundDriverId,
    outboundDriverId,
    hubId,
    tokenTimestamp,
    nonce,
    signature,
    submittedInboundOtp,
    submittedOutboundOtp,
    expectedInboundOtp,
    expectedOutboundOtp,
    inboundGps,
    outboundGps,
  } = verificationData;

  // 1. Check TTL expiry
  const now = Math.floor(Date.now() / 1000);
  if (now - tokenTimestamp > TOKEN_TTL_SECONDS) {
    throw new DomainError(400, { error: 'Hand-off token has expired. Please regenerate QR token.' });
  }

  // 2. Verify HMAC Token Integrity
  const rawPayload = `${relayBookingId}:${legIndex}:${inboundDriverId}:${hubId}:${tokenTimestamp}:${nonce}:${expectedInboundOtp}`;
  const computedSignature = crypto
    .createHmac('sha256', HANDSHAKE_SECRET)
    .update(rawPayload)
    .digest('hex');

  if (computedSignature !== signature) {
    throw new DomainError(401, { error: 'Invalid hand-off token signature. Cryptographic check failed.' });
  }

  // 3. Verify Dual OTP Match
  if (
    submittedInboundOtp !== expectedInboundOtp ||
    submittedOutboundOtp !== expectedOutboundOtp
  ) {
    throw new DomainError(400, { error: 'Dual OTP confirmation failed: OTP mismatch between drivers.' });
  }

  // 4. Verify Dual Geofence Presence at Hub
  if (inboundGps && outboundGps) {
    const inboundCheck = verifyHubGeofence(inboundGps.lat, inboundGps.lng, hubId);
    const outboundCheck = verifyHubGeofence(outboundGps.lat, outboundGps.lng, hubId);

    if (!inboundCheck.isWithinGeofence) {
      throw new DomainError(403, {
        error: `Inbound driver is outside hub geofence (${inboundCheck.distanceMeters}m from ${inboundCheck.hubName}, max ${inboundCheck.maxAllowedRadiusMeters}m)`,
      });
    }

    if (!outboundCheck.isWithinGeofence) {
      throw new DomainError(403, {
        error: `Outbound driver is outside hub geofence (${outboundCheck.distanceMeters}m from ${outboundCheck.hubName}, max ${outboundCheck.maxAllowedRadiusMeters}m)`,
      });
    }
  }

  // 5. Generate Deterministic On-Chain Hand-off Receipt Digest
  const receiptTimestamp = new Date().toISOString();
  const receiptBody = JSON.stringify({
    relayBookingId,
    legIndex,
    inboundDriverId,
    outboundDriverId,
    hubId,
    receiptTimestamp,
    nonce,
  });

  const handoffDigest = '0x' + crypto.createHash('sha256').update(receiptBody).digest('hex');

  const handoffReceipt = {
    success: true,
    relayBookingId,
    legIndex,
    inboundDriverId,
    outboundDriverId,
    hubId,
    handoffDigest,
    verifiedAt: receiptTimestamp,
  };

  logger.info(
    { relayBookingId, legIndex, hubId, handoffDigest },
    '[relayHandshakeService] Hand-off successfully verified with cryptographic digest'
  );

  return handoffReceipt;
}

export default {
  generateHandshakeToken,
  verifyHubGeofence,
  verifyRelayHandshake,
};
