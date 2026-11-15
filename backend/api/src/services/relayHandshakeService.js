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

const TOKEN_TTL_SECONDS = 600; // 10 minutes
const MIN_HANDSHAKE_SECRET_LENGTH = 32;

function getHandshakeSecret() {
  const secret = process.env.RELAY_HANDSHAKE_SECRET;
  if (typeof secret !== 'string' || secret.length < MIN_HANDSHAKE_SECRET_LENGTH) {
    throw new DomainError(503, {
      error: 'Relay handshake is not configured: set a RELAY_HANDSHAKE_SECRET of at least 32 characters.',
    });
  }
  return secret;
}

function signaturesMatch(expectedHex, providedHex) {
  if (typeof expectedHex !== 'string' || typeof providedHex !== 'string') return false;
  if (expectedHex.length !== providedHex.length) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const provided = Buffer.from(providedHex, 'hex');
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

/**
 * Generates an encrypted/signed QR hand-off payload for the inbound transferring driver.
 */
export function generateHandshakeToken(relayBookingId, legIndex, inboundDriverId, hubId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(8).toString('hex');
  const inboundOtp = crypto.randomInt(100000, 999999).toString();
  const outboundOtp = crypto.randomInt(100000, 999999).toString();

  const rawPayload = `${relayBookingId}:${legIndex}:${inboundDriverId}:${hubId}:${timestamp}:${nonce}:${inboundOtp}:${outboundOtp}`;
  const signature = crypto
    .createHmac('sha256', getHandshakeSecret())
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
    // An unregistered hub has no authoritative coordinates. Treating it as a
    // pass would let a caller skip the geofence by inventing an id.
    return {
      isWithinGeofence: false,
      distanceMeters: null,
      maxAllowedRadiusMeters: null,
      hubName: 'UNKNOWN_HUB',
      reason: 'UNKNOWN_HUB',
    };
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

  // 1. Check TTL expiry. A timestamp far in the future is also invalid; the
  // 60-second allowance covers ordinary clock skew between the two drivers.
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(tokenTimestamp) || tokenTimestamp > now + 60) {
    throw new DomainError(400, { error: 'Hand-off token timestamp is invalid.' });
  }
  if (now - tokenTimestamp > TOKEN_TTL_SECONDS) {
    throw new DomainError(400, { error: 'Hand-off token has expired. Please regenerate QR token.' });
  }

  // 2. Verify HMAC Token Integrity. Both OTPs are part of the signed payload so
  // the receiver cannot substitute a different outbound confirmation.
  const rawPayload = `${relayBookingId}:${legIndex}:${inboundDriverId}:${hubId}:${tokenTimestamp}:${nonce}:${expectedInboundOtp}:${expectedOutboundOtp}`;
  const computedSignature = crypto
    .createHmac('sha256', getHandshakeSecret())
    .update(rawPayload)
    .digest('hex');

  if (!signaturesMatch(computedSignature, signature)) {
    throw new DomainError(401, { error: 'Invalid hand-off token signature. Cryptographic check failed.' });
  }

  // 3. Verify Dual OTP Match
  if (
    submittedInboundOtp !== expectedInboundOtp ||
    submittedOutboundOtp !== expectedOutboundOtp
  ) {
    throw new DomainError(400, { error: 'Dual OTP confirmation failed: OTP mismatch between drivers.' });
  }

  // 4. Verify Dual Geofence Presence at Hub. Both drivers must provide fresh
  // coordinates; missing telemetry is not evidence that the hand-off happened.
  if (!inboundGps || !outboundGps) {
    throw new DomainError(403, {
      error: 'Both drivers must provide GPS coordinates before a relay hand-off can be verified.',
    });
  }

  const inboundCheck = verifyHubGeofence(inboundGps.lat, inboundGps.lng, hubId);
  const outboundCheck = verifyHubGeofence(outboundGps.lat, outboundGps.lng, hubId);

  if (!inboundCheck.isWithinGeofence) {
    throw new DomainError(403, {
      error: inboundCheck.reason === 'UNKNOWN_HUB'
        ? 'Inbound driver geofence cannot be verified: unknown hub id.'
        : `Inbound driver is outside hub geofence (${inboundCheck.distanceMeters}m from ${inboundCheck.hubName}, max ${inboundCheck.maxAllowedRadiusMeters}m)`,
    });
  }

  if (!outboundCheck.isWithinGeofence) {
    throw new DomainError(403, {
      error: outboundCheck.reason === 'UNKNOWN_HUB'
        ? 'Outbound driver geofence cannot be verified: unknown hub id.'
        : `Outbound driver is outside hub geofence (${outboundCheck.distanceMeters}m from ${outboundCheck.hubName}, max ${outboundCheck.maxAllowedRadiusMeters}m)`,
    });
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
