/**
 * Commercial Weigh Station & Federal Bridge Gross Weight Formula (23 CFR § 658.17) Engine.
 * Provides regulatory compliance verification across axle groups, spacing, and WIM bypass.
 */
import logger from '../middleware/logger.js';

// Standard Federal Limits (lbs)
export const FHWA_LIMITS = {
    MAX_SINGLE_AXLE_LBS: 20000,
    MAX_TANDEM_AXLE_LBS: 34000,
    MAX_INTERSTATE_GVW_LBS: 80000,
    MIN_TANDEM_SPACING_INCHES: 40,
    MAX_TANDEM_SPACING_INCHES: 96,
};

/**
 * Calculates the maximum allowable gross weight for a group of two or more consecutive axles
 * using the Federal Bridge Gross Weight Formula:
 * W = 500 * [ (L * N) / (N - 1) + 12N + 36 ]
 * rounded to the nearest 500 pounds.
 * 
 * @param {number} axleCount N - Number of axles in the group (N >= 2)
 * @param {number} distanceFeet L - Distance in feet between the extremes of any group of 2 or more consecutive axles
 * @returns {number} Maximum allowable gross weight in pounds
 */
export function calculateBridgeFormulaMaxWeight(axleCount, distanceFeet) {
    if (!Number.isInteger(axleCount) || axleCount < 2) {
        throw new RangeError('Axle count N must be an integer of 2 or greater');
    }
    if (!Number.isFinite(distanceFeet) || distanceFeet <= 0) {
        throw new RangeError('Axle spacing distance L must be a positive finite number in feet');
    }

    const n = axleCount;
    const l = distanceFeet;

    const rawWeight = 500 * ((l * n) / (n - 1) + 12 * n + 36);

    // FHWA requires rounding to the nearest 500 lbs
    const roundedWeight = Math.round(rawWeight / 500) * 500;

    // Cap at the federal maximum 80,000 lbs interstate limit unless permit exception applies
    return Math.min(roundedWeight, FHWA_LIMITS.MAX_INTERSTATE_GVW_LBS);
}

/**
 * Evaluates comprehensive Federal Bridge Formula compliance for a multi-axle truck configuration.
 * 
 * @param {Object} truckProfile
 * @param {Array<{ axleNumber: number, weightLbs: number, distanceFromSteerFeet: number }>} truckProfile.axles
 * @param {boolean} [truckProfile.hasOverweightPermit=false]
 * @returns {Object} Comprehensive compliance verdict with violations breakdown
 */
export function evaluateBridgeFormulaCompliance(truckProfile = {}) {
    const { axles = [], hasOverweightPermit = false, declaredGvwLbs } = truckProfile;

    if (!Array.isArray(axles) || axles.length < 2) {
        return {
            compliant: false,
            reason: 'At least 2 axles with weight and distance spacing are required for Bridge Formula evaluation',
            totalGvwLbs: 0,
            violations: []
        };
    }

    const violations = [];
    let totalWeightLbs = 0;

    // 1. Single Axle Check
    for (const axle of axles) {
        const weight = Number(axle.weightLbs);
        if (!Number.isFinite(weight) || weight < 0) {
            return {
                compliant: false,
                reason: `Invalid axle weight for axle ${axle.axleNumber}: must be non-negative finite number`,
                violations: []
            };
        }
        totalWeightLbs += weight;

        // Individual single axle check (20,000 lbs max)
        if (weight > FHWA_LIMITS.MAX_SINGLE_AXLE_LBS && !hasOverweightPermit) {
            violations.push({
                type: 'SINGLE_AXLE_OVERLOAD',
                axleNumber: axle.axleNumber,
                actualWeightLbs: weight,
                allowedWeightLbs: FHWA_LIMITS.MAX_SINGLE_AXLE_LBS,
                excessLbs: weight - FHWA_LIMITS.MAX_SINGLE_AXLE_LBS,
                severity: 'CRITICAL'
            });
        }
    }

    // 2. Gross Vehicle Weight Cap (80,000 lbs max on Interstates)
    const effectiveGvw = declaredGvwLbs || totalWeightLbs;
    if (effectiveGvw > FHWA_LIMITS.MAX_INTERSTATE_GVW_LBS && !hasOverweightPermit) {
        violations.push({
            type: 'GVW_INTERSTATE_OVERLOAD',
            actualWeightLbs: effectiveGvw,
            allowedWeightLbs: FHWA_LIMITS.MAX_INTERSTATE_GVW_LBS,
            excessLbs: effectiveGvw - FHWA_LIMITS.MAX_INTERSTATE_GVW_LBS,
            severity: 'CRITICAL'
        });
    }

    // 3. Consecutive Axle Groups Bridge Formula Check
    const n = axles.length;
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const groupAxleCount = j - i + 1;
            const outerAxleDistanceFeet = Math.abs(axles[j].distanceFromSteerFeet - axles[i].distanceFromSteerFeet);

            if (outerAxleDistanceFeet <= 0) continue;

            let groupWeight = 0;
            for (let k = i; k <= j; k++) {
                groupWeight += axles[k].weightLbs;
            }

            // Standard tandem check for axles spaced <= 8 feet (96 inches)
            if (groupAxleCount === 2 && outerAxleDistanceFeet <= (FHWA_LIMITS.MAX_TANDEM_SPACING_INCHES / 12)) {
                if (groupWeight > FHWA_LIMITS.MAX_TANDEM_AXLE_LBS && !hasOverweightPermit) {
                    violations.push({
                        type: 'TANDEM_AXLE_OVERLOAD',
                        axleGroup: [axles[i].axleNumber, axles[j].axleNumber],
                        spacingFeet: outerAxleDistanceFeet,
                        actualWeightLbs: groupWeight,
                        allowedWeightLbs: FHWA_LIMITS.MAX_TANDEM_AXLE_LBS,
                        excessLbs: groupWeight - FHWA_LIMITS.MAX_TANDEM_AXLE_LBS,
                        severity: 'CRITICAL'
                    });
                }
            }

            // Bridge Formula table limit for consecutive group
            let bridgeFormulaAllowed = calculateBridgeFormulaMaxWeight(groupAxleCount, outerAxleDistanceFeet);

            // FHWA Statutory Exception (23 U.S.C. § 127):
            // Two consecutive sets of tandem axles may carry 34,000 lbs each (68,000 lbs total)
            // provided the overall distance between the first and last axles of such consecutive sets is 36 feet or more.
            if (groupAxleCount === 4 && outerAxleDistanceFeet >= 36) {
                bridgeFormulaAllowed = Math.max(bridgeFormulaAllowed, 68000);
            }

            if (groupWeight > bridgeFormulaAllowed && !hasOverweightPermit) {
                violations.push({
                    type: 'BRIDGE_FORMULA_GROUP_VIOLATION',
                    axleGroup: [axles[i].axleNumber, axles[j].axleNumber],
                    axleCount: groupAxleCount,
                    spacingFeet: outerAxleDistanceFeet,
                    actualWeightLbs: groupWeight,
                    allowedWeightLbs: bridgeFormulaAllowed,
                    excessLbs: groupWeight - bridgeFormulaAllowed,
                    severity: 'CRITICAL'
                });
            }
        }
    }

    const compliant = violations.length === 0;

    return {
        compliant,
        totalGvwLbs: effectiveGvw,
        maxFederalGvwLbs: FHWA_LIMITS.MAX_INTERSTATE_GVW_LBS,
        axleCount: axles.length,
        hasOverweightPermit,
        violationsCount: violations.length,
        violations,
        verdict: compliant ? 'COMPLIANT_FOR_BYPASS' : 'VIOLATION_PULL_IN_REQUIRED'
    };
}

/**
 * Mock Commercial Bypass API integration.
 * In a real-world scenario, this service would communicate with Drivewyze or PrePass API
 * to check carrier credentials and safety scores against the specific weigh station.
 */
export const checkBypassEligibility = async (driverId, lat, lng) => {
    return {
        action: 'UNSUPPORTED',
        supported: false,
        simulated: true,
        stationId: null,
        reason: 'Weigh-in-motion bypass is not available: no WIM provider is configured. This is not a regulatory verdict.',
        timestamp: new Date().toISOString(),
    };
};

/**
 * Syncs highly accurate internal air suspension weights with DOT enforcement software.
 * Returns an UNSUPPORTED response until a real WIM provider (Drivewyze/PrePass) API is integrated.
 */
export const syncAndTransmitInternalWeights = async (driverId, truckId, axles) => {
    logger.warn('[WeighStation] syncAndTransmitInternalWeights called but no WIM provider is configured -- returning unsupported');
    return {
        action: 'UNSUPPORTED',
        supported: false,
        stationId: null,
        reason: 'Weigh-in-motion sync is not available: no WIM provider (Drivewyze/PrePass) is configured. Configure WIM_PROVIDER_API_KEY to enable.',
        timestamp: new Date().toISOString(),
    };
};

export default {
    calculateBridgeFormulaMaxWeight,
    evaluateBridgeFormulaCompliance,
    checkBypassEligibility,
    syncAndTransmitInternalWeights,
    FHWA_LIMITS
};
