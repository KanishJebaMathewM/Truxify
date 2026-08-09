import crypto from 'crypto';

// Secret key for signing pre-clearance packets. There is no production
// fallback: without a configured secret the service fails fast at startup
// rather than silently signing packets with a public, hardcoded value.
const IS_TEST = process.env.NODE_ENV === 'test';
const PACKET_SIGNING_SECRET = process.env.WIM_SIGNING_SECRET || (IS_TEST ? 'wim-bypass-test-secret' : null);

if (!PACKET_SIGNING_SECRET) {
  throw new Error('WIM_SIGNING_SECRET environment variable is required to sign WIM bypass packets.');
}

/**
 * Validates truck criteria for weigh station bypass.
 * @param {Object} truckData - Contains safetyScore, preClearedAxleWeights, and maxWeightLimit.
 * @returns {Boolean} - True if eligible for bypass.
 */
export function evaluateBypassEligibility(truckData) {
    const { safetyScore, axleWeight, maxWeightLimit } = truckData;
    const MIN_SAFETY_SCORE = 80;

    if (typeof safetyScore !== 'number' || safetyScore < MIN_SAFETY_SCORE) {
        return false;
    }

    if (typeof axleWeight !== 'number' || axleWeight > maxWeightLimit) {
        return false;
    }

    return true;
}

/**
 * Generates a cryptographically signed packet for state DOT WIM sensors.
 * @param {Object} payload - { truckId, safetyScore, bolId, axleWeight }
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
