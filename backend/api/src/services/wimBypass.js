import crypto from 'crypto';
import { evaluateBridgeFormulaCompliance } from './weighStationService.js';

// Secret key for signing pre-clearance packets.
const PACKET_SIGNING_SECRET = process.env.WIM_SIGNING_SECRET || 'wim-bypass-fallback-secret-2026';

/**
 * Validates truck criteria for weigh station bypass against gross weights and Bridge Formula axle limits.
 * @param {Object} truckData - Contains safetyScore, axleWeight, maxWeightLimit, and optional axles array.
 * @returns {Boolean} - True if eligible for bypass.
 */
export function evaluateBypassEligibility(truckData = {}) {
    const { safetyScore, axleWeight, maxWeightLimit, axles, hasOverweightPermit } = truckData;
    const MIN_SAFETY_SCORE = 80;

    if (typeof safetyScore !== 'number' || safetyScore < MIN_SAFETY_SCORE) {
        return false;
    }

    if (typeof axleWeight !== 'number' || typeof maxWeightLimit !== 'number') {
        return false;
    }
    if (axleWeight > maxWeightLimit) {
        return false;
    }

    // If granular axle distribution is provided, enforce Federal Bridge Formula compliance
    if (Array.isArray(axles) && axles.length >= 2) {
        const compliance = evaluateBridgeFormulaCompliance({
            axles,
            declaredGvwLbs: axleWeight,
            hasOverweightPermit: Boolean(hasOverweightPermit)
        });
        if (!compliance.compliant) {
            return false;
        }
    }

    return true;
}

/**
 * Generates a cryptographically signed packet for state DOT WIM sensors.
 * @param {Object} payload - { truckId, safetyScore, bolId, axleWeight, [axles] }
 * @returns {Object} Signed packet with HMAC signature.
 */
export function createSignedWimPacket(payload) {
    const timestamp = Date.now();
    const packetData = {
        ...payload,
        timestamp,
    };

    const serialized = JSON.stringify(packetData);
    const signature = crypto
        .createHmac('sha256', PACKET_SIGNING_SECRET)
        .update(serialized)
        .digest('hex');

    return {
        packet: packetData,
        signature,
    };
}

/**
 * Verifies a state DOT WIM sensor packet against forgery and replay attacks.
 * @param {Object} signedData - { packet, signature }
 * @param {number} [maxAgeMs=300000] - Replay threshold window (default 5 minutes)
 * @returns {Object} { valid: boolean, reason?: string, packet?: object }
 */
export function verifySignedWimPacket(signedData, maxAgeMs = 300000) {
    if (!signedData || typeof signedData !== 'object' || !signedData.packet || !signedData.signature) {
        return { valid: false, reason: 'Malformed signed packet payload' };
    }

    const { packet, signature } = signedData;

    if (!packet.timestamp || typeof packet.timestamp !== 'number') {
        return { valid: false, reason: 'Missing or invalid packet timestamp' };
    }

    // Replay attack defense: packet must not be older than maxAgeMs or in the future
    const now = Date.now();
    if (now - packet.timestamp > maxAgeMs) {
        return { valid: false, reason: 'Packet expired (replay attack defense)' };
    }
    if (packet.timestamp > now + 60000) {
        return { valid: false, reason: 'Packet timestamp from future' };
    }

    const serialized = JSON.stringify(packet);
    const expectedSignature = crypto
        .createHmac('sha256', PACKET_SIGNING_SECRET)
        .update(serialized)
        .digest('hex');

    try {
        const valid = crypto.timingSafeEqual(
            Buffer.from(signature, 'hex'),
            Buffer.from(expectedSignature, 'hex')
        );
        return {
            valid,
            reason: valid ? null : 'Cryptographic signature mismatch',
            packet: valid ? packet : null
        };
    } catch {
        return { valid: false, reason: 'Failed to decode signature bytes' };
    }
}

export default {
    evaluateBypassEligibility,
    createSignedWimPacket,
    verifySignedWimPacket,
};
