import crypto from 'crypto';

/**
 * SAE J1939 Parameter Group Numbers (PGNs) for commercial vehicle telematics.
 */
export const J1939_PGNS = {
    EEC1: { pgn: 61444, name: 'Electronic Engine Controller 1', spns: [190, 512, 513] },
    LFE: { pgn: 65266, name: 'Fuel Economy (Liquid)', spns: [184, 185] },
    DM1: { pgn: 65226, name: 'Active Diagnostic Trouble Codes', spns: [1214, 1215] },
    PROP_FLASH: { pgn: 65280, name: 'Proprietary Calibration Flash', spns: [9001] }
};

/**
 * ISO 14229 Unified Diagnostic Services (UDS) Service IDs.
 */
export const UDS_SERVICES = {
    DIAGNOSTIC_SESSION_CONTROL: 0x10,
    SECURITY_ACCESS: 0x27,
    ROUTINE_CONTROL: 0x31,
    REQUEST_DOWNLOAD: 0x34,
    TRANSFER_DATA: 0x36,
    REQUEST_TRANSFER_EXIT: 0x37
};

/**
 * ECM Profile Configurations for Commercial Vehicle Engines.
 */
export const ECM_PROFILES = {
    ECO_FLAT: {
        profileId: 'PROFILE_ECO_FLAT_v2.4',
        mode: 'FLAT_HIGHWAY_ECO',
        maxTorqueNm: 1850,
        shiftPointRpm: 1400,
        fuelEfficiencyBias: 'MAXIMUM_ECONOMY',
        engineBrakingLevel: 'LOW'
    },
    MOUNTAIN_POWER: {
        profileId: 'PROFILE_MOUNTAIN_POWER_v3.1',
        mode: 'STEEP_CLIMB_PERFORMANCE',
        maxTorqueNm: 2500,
        shiftPointRpm: 1950,
        fuelEfficiencyBias: 'HIGH_TORQUE_PULLING',
        engineBrakingLevel: 'HIGH'
    },
    DESCENT_REGEN: {
        profileId: 'PROFILE_DESCENT_REGEN_v1.8',
        mode: 'DOWNGRADIENT_RETARDER',
        maxTorqueNm: 1600,
        shiftPointRpm: 1700,
        fuelEfficiencyBias: 'REGEN_AND_BRAKING',
        engineBrakingLevel: 'MAXIMUM'
    }
};

/**
 * Computes moving-average road gradient percentage across elevation points
 * to filter out transient GPS altitude jitter and prevent profile chattering.
 * 
 * @param {Array<{ distanceMeters: number, elevationMeters: number }>} elevationWaypoints
 * @returns {number} Filtered average gradient percentage (rise / run * 100)
 */
export function calculateRollingElevationGradient(elevationWaypoints = []) {
    if (!Array.isArray(elevationWaypoints) || elevationWaypoints.length < 2) {
        return 0;
    }

    let totalRiseMeters = 0;
    let totalRunMeters = 0;

    for (let i = 1; i < elevationWaypoints.length; i++) {
        const deltaElevation = elevationWaypoints[i].elevationMeters - elevationWaypoints[i - 1].elevationMeters;
        const deltaDistance = Math.max(1, elevationWaypoints[i].distanceMeters - elevationWaypoints[i - 1].distanceMeters);

        totalRiseMeters += deltaElevation;
        totalRunMeters += deltaDistance;
    }

    if (totalRunMeters <= 0) return 0;

    const rawGradientPercent = (totalRiseMeters / totalRunMeters) * 100;
    return parseFloat(rawGradientPercent.toFixed(2));
}

/**
 * Analyzes route topology (gradient/elevation trend) and selects optimal ECM profile.
 * 
 * @param {Object} topologyData - { averageGradientPercent, maxElevationFt, upcomingTerrain, waypoints }
 * @returns {Object} Selected ECM tuning profile
 */
export function determineOptimalEcmProfile(topologyData = {}) {
    let gradient = topologyData.averageGradientPercent;

    if (gradient === undefined && Array.isArray(topologyData.waypoints) && topologyData.waypoints.length >= 2) {
        gradient = calculateRollingElevationGradient(topologyData.waypoints);
    }

    const { upcomingTerrain = 'FLAT' } = topologyData;
    const effectiveGradient = Number.isFinite(gradient) ? gradient : 0;
    const terrainUpper = String(upcomingTerrain).toUpperCase();

    if (effectiveGradient >= 3.5 || terrainUpper === 'MOUNTAIN_CLIMB') {
        return ECM_PROFILES.MOUNTAIN_POWER;
    } else if (effectiveGradient <= -3.0 || terrainUpper === 'MOUNTAIN_DESCENT') {
        return ECM_PROFILES.DESCENT_REGEN;
    }

    return ECM_PROFILES.ECO_FLAT;
}

/**
 * Generates an Over-The-Air (OTA) cryptographically signed payload for the truck's telematics gateway.
 * 
 * @param {Object} tuningParams - { truckId, vin, topologyData }
 * @returns {Object} Signed OTA update package ready for CAN-bus dispatch
 */
export function generateOtaTuningPayload(tuningParams = {}) {
    const { truckId, vin = 'UNKNOWN_VIN', topologyData = {} } = tuningParams;

    const targetProfile = determineOptimalEcmProfile(topologyData);
    const timestamp = Date.now();

    const otaPackage = {
        truckId,
        vin,
        targetProfile,
        dispatchTimestamp: timestamp,
        validityWindowSeconds: 3600
    };

    // Sign payload with HMAC SHA-256 for secure gateway verification
    const secret = process.env.ECM_OTA_SIGNING_KEY || 'ecm-ota-secure-key';
    const signature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(otaPackage))
        .digest('hex');

    return {
        otaPackage,
        signature,
        status: 'READY_FOR_TRANSMISSION'
    };
}

/**
 * Verifies the authenticity and expiration window of an inbound OTA tuning payload.
 * 
 * @param {Object} otaPackage
 * @param {string} signature
 * @returns {Object} Verification result
 */
export function verifyOtaTuningPayload(otaPackage, signature) {
    if (!otaPackage || !signature || typeof signature !== 'string') {
        return { valid: false, reason: 'Malformed payload or missing signature' };
    }

    const now = Date.now();
    const elapsedSeconds = (now - (otaPackage.dispatchTimestamp || 0)) / 1000;

    if (elapsedSeconds > (otaPackage.validityWindowSeconds || 3600)) {
        return { valid: false, reason: 'OTA tuning package has expired' };
    }
    if (elapsedSeconds < -60) {
        return { valid: false, reason: 'OTA dispatch timestamp is in the future' };
    }

    const secret = process.env.ECM_OTA_SIGNING_KEY || 'ecm-ota-secure-key';
    const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(otaPackage))
        .digest('hex');

    try {
        const valid = crypto.timingSafeEqual(
            Buffer.from(signature, 'hex'),
            Buffer.from(expected, 'hex')
        );
        return { valid, reason: valid ? null : 'Cryptographic signature mismatch' };
    } catch {
        return { valid: false, reason: 'Failed to decode signature bytes' };
    }
}

/**
 * Calculates a standard CCITT CRC-16 checksum for CAN frame integrity.
 */
export function calculateCrc16(buffer) {
    let crc = 0xFFFF;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= buffer[i] << 8;
        for (let j = 0; j < 8; j++) {
            if ((crc & 0x8000) !== 0) {
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
            } else {
                crc = (crc << 1) & 0xFFFF;
            }
        }
    }
    return crc;
}

/**
 * Encapsulates an OTA ECM calibration package into a sequence of SAE J1939 CAN-bus frames (8-byte payloads)
 * conforming to Transport Protocol Data Transfer (TP.DT / PGN 60160).
 * 
 * @param {Object} otaResult
 * @returns {Array<Object>} Sequence of J1939 CAN 2.0B extended ID binary frames
 */
export function packageIntoJ1939CanFrames(otaResult) {
    if (!otaResult || !otaResult.otaPackage) {
        throw new TypeError('Valid otaResult with otaPackage is required');
    }

    const rawJson = JSON.stringify(otaResult);
    const rawBuffer = Buffer.from(rawJson, 'utf-8');
    const totalBytes = rawBuffer.length;

    const frames = [];
    const payloadChunkSize = 7; // Byte 0 = Sequence Number (1-255), Bytes 1-7 = Data
    const totalPackets = Math.ceil(totalBytes / payloadChunkSize);

    // Header Connection Management frame (TP.CM / PGN 60416)
    const canIdBAM = 0x18ECFF00; // Broadcast Announce Message
    frames.push({
        frameIndex: 0,
        canIdHex: '0x' + canIdBAM.toString(16).toUpperCase(),
        pgn: 60416,
        type: 'TP_CM_BAM',
        dataBytesHex: Buffer.from([0x20, totalBytes & 0xFF, (totalBytes >> 8) & 0xFF, totalPackets, 0xFF, 0x00, 0xFF, 0x00]).toString('hex')
    });

    // Sequence of Data Transfer frames (TP.DT / PGN 60160)
    const canIdDT = 0x18EBFF00;
    for (let seq = 1; seq <= totalPackets; seq++) {
        const offset = (seq - 1) * payloadChunkSize;
        const chunk = rawBuffer.subarray(offset, Math.min(totalBytes, offset + payloadChunkSize));

        // Pad up to 7 bytes with 0xFF per SAE J1939-21 standard
        const paddedChunk = Buffer.alloc(payloadChunkSize, 0xFF);
        chunk.copy(paddedChunk);

        const framePayload = Buffer.concat([Buffer.from([seq]), paddedChunk]);
        const crc = calculateCrc16(framePayload);

        frames.push({
            frameIndex: seq,
            canIdHex: '0x' + canIdDT.toString(16).toUpperCase(),
            pgn: 60160,
            sequenceNumber: seq,
            type: 'TP_DT',
            dataBytesHex: framePayload.toString('hex'),
            crc16Hex: '0x' + crc.toString(16).padStart(4, '0').toUpperCase()
        });
    }

    return {
        totalFrames: frames.length,
        totalPayloadBytes: totalBytes,
        targetVin: otaResult.otaPackage.vin,
        profileId: otaResult.otaPackage.targetProfile.profileId,
        frames
    };
}

export default {
    determineOptimalEcmProfile,
    generateOtaTuningPayload,
    verifyOtaTuningPayload,
    calculateRollingElevationGradient,
    packageIntoJ1939CanFrames,
    calculateCrc16,
    ECM_PROFILES,
    J1939_PGNS,
    UDS_SERVICES
};
