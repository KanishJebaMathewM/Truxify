import crypto from 'crypto';
import { supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';
import {
  getWimSigningSecret,
  getWimCredentialTtlMs,
  getMaxWimMeasurementAgeMs,
} from '../config/wim.js';

/**
 * WIM bypass trust boundary.
 *
 * A bypass credential is ONLY ever derived from server-controlled records:
 *   - truck.max_capacity_tons       (registered capacity)
 *   - order.weight_tonnes           (registered load weight)
 *   - profiles.is_digilocker_verified (verified driver registration)
 *
 * Client-supplied safetyScore / axleWeight / maxWeightLimit / timestamps are
 * never consulted. Request.body only contributes truckId + bolId, both of
 * which are cross-checked against the authenticated driver's ownership.
 *
 * Every issued credential is short-lived and single-use:
 *   - issuedAt / expiresAt are server-assigned.
 *   - credentialId is a unique nonce, durably stored.
 *   - consumeWimCredential() atomically flips issued -> consumed, so a
 *     captured packet cannot be replayed.
 */

export const MIN_SAFETY_SCORE = 80;
export const WIM_PACKET_VERSION = 2;
export const WIM_MEASUREMENT_SOURCE = 'server-derived';
export const LBS_PER_TONNE = 2000;

export const CREDENTIAL_STATUS = Object.freeze({
  ISSUED: 'issued',
  CONSUMED: 'consumed',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
});

/**
 * Deterministic, key-ordered JSON serialization for canonical HMAC input.
 *
 * JSON.stringify depends on property insertion order, which must never drive
 * signature verification. This serializer recursively sorts object keys so
 * the signer and the verifier always produce byte-identical input.
 *
 * @param {*} value - Value to serialize.
 * @returns {string} Canonical JSON string.
 */
export function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const body = keys
    .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`)
    .join(',');
  return `{${body}}`;
}

/**
 * Validates truck criteria for weigh station bypass.
 * @param {Object} truckData - { safetyScore, axleWeight, maxWeightLimit }.
 * @returns {boolean} True if eligible for bypass.
 */
export function evaluateBypassEligibility(truckData) {
  const { safetyScore, axleWeight, maxWeightLimit } = truckData;

  if (typeof safetyScore !== 'number' || !Number.isFinite(safetyScore)) {
    return false;
  }
  if (typeof axleWeight !== 'number' || !Number.isFinite(axleWeight)) {
    return false;
  }
  if (typeof maxWeightLimit !== 'number' || !Number.isFinite(maxWeightLimit)) {
    return false;
  }

  if (safetyScore < MIN_SAFETY_SCORE) {
    return false;
  }
  if (axleWeight > maxWeightLimit) {
    return false;
  }

  return true;
}

/**
 * Builds a trusted measurement snapshot from server-controlled records only.
 *
 * @param {Object} inputs
 * @param {Object} inputs.truck - trucks row: { id, driver_id, max_capacity_tons }.
 * @param {Object} inputs.order - orders row: { order_display_id, driver_id, truck_id, weight_tonnes }.
 * @param {Object} [inputs.driverProfile] - profiles row: { is_digilocker_verified }.
 * @returns {{ truckId: string, orderDisplayId: string, driverId: string,
 *             weightLbs: number, capacityLbs: number, safetyScore: number,
 *             source: string, measuredAt: number }}
 */
export function buildTrustedMeasurement({ truck, order, driverProfile }) {
  return {
    truckId: truck.id,
    orderDisplayId: order.order_display_id,
    driverId: order.driver_id,
    weightLbs: Number(order.weight_tonnes) * LBS_PER_TONNE,
    capacityLbs: Number(truck.max_capacity_tons) * LBS_PER_TONNE,
    safetyScore: driverProfile?.is_digilocker_verified ? 100 : 0,
    source: WIM_MEASUREMENT_SOURCE,
    measuredAt: Date.now(),
  };
}

/**
 * Validates a trusted measurement against server-side expectations:
 *   - source must be the server-derived source,
 *   - the measurement must be fresh (age <= maxAgeMs),
 *   - the measurement must belong to the requested vehicle/load.
 *
 * This is the guard that stops Vehicle A's measurement from issuing Vehicle
 * B's credential and that rejects stale snapshots.
 *
 * @param {Object} measurement - Measurement record (id, truckId, orderDisplayId,
 *   measuredAt epoch ms, source).
 * @param {Object} expected
 * @param {string} expected.expectedTruckId
 * @param {string} expected.expectedOrderDisplayId
 * @param {number} expected.maxAgeMs
 * @returns {{ valid: boolean, reason: string | null }}
 */
export function validateTrustedMeasurement(measurement, { expectedTruckId, expectedOrderDisplayId, maxAgeMs }) {
  if (!measurement || typeof measurement !== 'object') {
    return { valid: false, reason: 'missing-measurement' };
  }
  if (measurement.source && measurement.source !== WIM_MEASUREMENT_SOURCE) {
    return { valid: false, reason: 'untrusted-measurement-source' };
  }
  if (String(measurement.truckId) !== String(expectedTruckId)) {
    return { valid: false, reason: 'measurement-vehicle-mismatch' };
  }
  if (String(measurement.orderDisplayId) !== String(expectedOrderDisplayId)) {
    return { valid: false, reason: 'measurement-load-mismatch' };
  }

  const measuredAt = Number(measurement.measuredAt);
  if (!Number.isFinite(measuredAt)) {
    return { valid: false, reason: 'invalid-measurement-timestamp' };
  }
  const ageMs = Date.now() - measuredAt;
  if (ageMs < 0 || ageMs > maxAgeMs) {
    return { valid: false, reason: 'stale-measurement' };
  }

  return { valid: true, reason: null };
}

/**
 * Builds the credential record (before persistence / signing).
 *
 * @param {Object} options
 * @param {Object} options.measurement - Stored measurement row.
 * @param {boolean} options.eligibility - evaluateBypassEligibility() result.
 * @param {number} [options.now] - Epoch ms override for tests.
 * @returns {Object} Credential payload (unsigned).
 */
export function buildCredential({ measurement, eligibility, now = Date.now() }) {
  const ttlMs = getWimCredentialTtlMs();
  const issuedAt = now;
  const expiresAt = issuedAt + ttlMs;

  return {
    credentialId: crypto.randomUUID(),
    measurementId: measurement.id,
    truckId: measurement.truckId,
    orderDisplayId: measurement.orderDisplayId,
    driverId: measurement.driverId,
    safetyScore: measurement.safetyScore,
    axleWeightLbs: measurement.weightLbs,
    capacityLbs: measurement.capacityLbs,
    eligible: eligibility,
    issuedAt,
    expiresAt,
  };
}

/**
 * Signs a WIM bypass packet using HMAC-SHA256 over the canonical
 * representation of the packet. Throws (fail closed) when the signing secret
 * is not configured.
 *
 * @param {Object} credential - Credential payload returned by buildCredential().
 * @returns {{ packet: Object, signature: string }}
 */
export function createSignedWimPacket(credential) {
  const secret = getWimSigningSecret();

  const packetData = {
    v: WIM_PACKET_VERSION,
    credentialId: credential.credentialId,
    measurementId: credential.measurementId,
    truckId: credential.truckId,
    bolId: credential.orderDisplayId,
    safetyScore: credential.safetyScore,
    axleWeight: credential.axleWeightLbs,
    maxWeightLimit: credential.capacityLbs,
    eligibility: credential.eligible,
    timestamp: credential.issuedAt,
    issuedAt: credential.issuedAt,
    expiresAt: credential.expiresAt,
  };

  const serialized = canonicalStringify(packetData);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(serialized, 'utf8')
    .digest('hex');

  return { packet: packetData, signature };
}

/**
 * Verifies a signed WIM packet without touching the database.
 *
 * Rejects: malformed packets, unsupported versions, tampered payloads
 * (signature mismatch via constant-time comparison), missing signing config,
 * and expired credentials. Successful verification still requires a durable
 * consumption step before the credential may be used.
 *
 * @param {Object} packet - { packet, signature }.
 * @param {Object} [options]
 * @param {string} [options.secret] - Override signing secret (tests).
 * @param {number} [options.now] - Epoch ms override (tests).
 * @returns {{ valid: boolean, reason: string, packetData?: Object }}
 */
export function verifyWimPacket(packet, { secret, now = Date.now() } = {}) {
  if (!packet || typeof packet !== 'object') {
    return { valid: false, reason: 'malformed-packet' };
  }
  const { packet: packetData, signature } = packet;
  if (!packetData || typeof packetData !== 'object') {
    return { valid: false, reason: 'malformed-packet' };
  }
  if (typeof signature !== 'string' || signature.length === 0) {
    return { valid: false, reason: 'malformed-packet' };
  }

  let key;
  if (secret !== undefined) {
    key = secret;
  } else {
    try {
      key = getWimSigningSecret();
    } catch (err) {
      logger.error('[WIM] verifyWimPacket failed: signing secret unavailable');
      return { valid: false, reason: 'signing-config-missing' };
    }
  }

  const serialized = canonicalStringify(packetData);
  const expected = crypto.createHmac('sha256', key).update(serialized, 'utf8').digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return { valid: false, reason: 'invalid-signature' };
  }

  if (packetData.v !== WIM_PACKET_VERSION) {
    return { valid: false, reason: 'unsupported-version' };
  }
  if (typeof packetData.credentialId !== 'string' || packetData.credentialId.length === 0) {
    return { valid: false, reason: 'missing-credential-id' };
  }

  const issuedAt = Number(packetData.issuedAt);
  const expiresAt = Number(packetData.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
    return { valid: false, reason: 'invalid-expiry' };
  }
  if (now < issuedAt || now > expiresAt) {
    return { valid: false, reason: 'expired-credential' };
  }

  return { valid: true, reason: null, packetData };
}

/**
 * Persists a trusted measurement snapshot. Never fails silently: a storage
 * error prevents credential issuance.
 *
 * @param {Object} measurement - from buildTrustedMeasurement().
 * @returns {Promise<Object>} Measurement record including its id.
 * @throws {Error} On database failure.
 */
export async function storeWimMeasurement(measurement) {
  if (!supabaseAdmin) {
    throw new Error('Database is not configured for WIM measurement storage.');
  }

  const row = {
    measurement_nonce: crypto.randomUUID(),
    truck_id: measurement.truckId,
    order_display_id: measurement.orderDisplayId,
    driver_id: measurement.driverId,
    weight_lbs: measurement.weightLbs,
    capacity_lbs: measurement.capacityLbs,
    safety_score: measurement.safetyScore,
    source: WIM_MEASUREMENT_SOURCE,
    measured_at: new Date(measurement.measuredAt).toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from('wim_measurements')
    .insert(row)
    .select('id')
    .single();

  if (error || !data?.id) {
    logger.error({ err: error }, '[WIM] Failed to store trusted measurement');
    throw new Error('Failed to store trusted measurement.');
  }

  return { ...measurement, id: data.id };
}

/**
 * Durably persists an issued bypass credential. credential_id is unique, so a
 * duplicate nonce fails closed instead of issuing two credentials.
 *
 * @param {Object} credential - from buildCredential().
 * @returns {Promise<Object>} Stored row (id, credential_id).
 * @throws {Error} On database failure or duplicate nonce.
 */
export async function storeWimCredential(credential) {
  if (!supabaseAdmin) {
    throw new Error('Database is not configured for WIM credential storage.');
  }

  const row = {
    credential_id: credential.credentialId,
    measurement_id: credential.measurementId,
    driver_id: credential.driverId,
    truck_id: credential.truckId,
    order_display_id: credential.orderDisplayId,
    safety_score: credential.safetyScore,
    axle_weight_lbs: credential.axleWeightLbs,
    eligible: credential.eligible,
    issued_at: new Date(credential.issuedAt).toISOString(),
    expires_at: new Date(credential.expiresAt).toISOString(),
    status: CREDENTIAL_STATUS.ISSUED,
  };

  const { data, error } = await supabaseAdmin
    .from('wim_bypass_credentials')
    .insert(row)
    .select('id, credential_id')
    .single();

  if (error || !data) {
    logger.error({ err: error }, '[WIM] Failed to persist bypass credential');
    throw new Error('Failed to persist bypass credential.');
  }

  return data;
}

/**
 * Atomically marks a credential as consumed (single-use replay protection).
 *
 * The conditional UPDATE only matches credentials that are still in the
 * 'issued' state and unexpired, so the first consumer wins and any replay is
 * rejected. Relies on the DB row lock, not on in-memory state.
 *
 * @param {string} credentialId - Unique credential nonce.
 * @returns {Promise<Object|null>} Updated row on success, null on replay / expiry.
 */
export async function consumeWimCredential(credentialId) {
  if (!supabaseAdmin) {
    logger.warn('[WIM] consumeWimCredential skipped: database not configured');
    return null;
  }

  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('wim_bypass_credentials')
    .update({ consumed_at: now, status: CREDENTIAL_STATUS.CONSUMED })
    .eq('credential_id', credentialId)
    .eq('status', CREDENTIAL_STATUS.ISSUED)
    .gt('expires_at', now)
    .select('id')
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}
