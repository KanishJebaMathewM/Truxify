import crypto from 'crypto';

// Secret key for signing pre-clearance packets
const PACKET_SIGNING_SECRET = process.env.WIM_SIGNING_SECRET || 'wim-bypass-secret-key';

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
