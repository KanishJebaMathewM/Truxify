import crypto from 'crypto';

/**
 * ECM Profile Configurations for Commercial Vehicle Engines.
 */
const ECM_PROFILES = {
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
 * Analyzes route topology (gradient/elevation trend) and selects optimal ECM profile.
 * 
 * @param {Object} topologyData - { averageGradientPercent, maxElevationFt, upcomingTerrain }
 * @returns {Object} Selected ECM tuning profile
 */
export function determineOptimalEcmProfile(topologyData) {
    const { averageGradientPercent = 0, upcomingTerrain = 'FLAT' } = topologyData;

    if (averageGradientPercent >= 3.5 || upcomingTerrain.toUpperCase() === 'MOUNTAIN_CLIMB') {
        return ECM_PROFILES.MOUNTAIN_POWER;
    } else if (averageGradientPercent <= -3.0 || upcomingTerrain.toUpperCase() === 'MOUNTAIN_DESCENT') {
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
export function generateOtaTuningPayload(tuningParams) {
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
