import {
  AxleWeightOptimizationService,
  defaultAxleWeightService,
  calculateAxleWeightDistribution,
  pack3dLifoCargo,
  calculateConsolidationYield,
  CMVR_AXLE_LIMITS_KG,
  CMVR_SAFETY_THRESHOLDS,
  DEFAULT_TRUCK_SPEC,
} from './consolidation/AxleWeightOptimizationService.js';

/**
 * Evaluates spot market partial loads against a truck's available capacity and route parameters.
 * Supports legacy scalar filtering as well as statutory CMVR axle weight statics and
 * 3D LIFO combinatorial drop sequencing.
 * 
 * @param {Object} truck - { id, currentRoute, remainingLinearFeet, remainingWeightLbs, remainingWeightKg, maxDelayMinutesTolerance, truckSpec, enforceCmvrLimits, enforce3dLifo }
 * @param {Array} partialLoads - Array of candidate LTL loads from spot market
 * @param {Object} [options={}] - Consolidation options
 * @returns {Object} Matching results ranked by profitability, physical compatibility, and CMVR compliance
 */
export function matchLtlPartialLoads(truck, partialLoads = [], options = {}) {
    const {
        remainingLinearFeet = 0,
        remainingWeightLbs = 0,
        remainingWeightKg = null,
        maxDelayMinutesTolerance = 60,
        enforceCmvrLimits = options.enforceCmvrLimits || false,
        enforce3dLifo = options.enforce3dLifo || false,
        truckSpec = {},
    } = truck;

    // Convert lbs to kg if needed (1 lb ≈ 0.45359237 kg)
    const effectiveRemainingKg = remainingWeightKg !== null
        ? remainingWeightKg
        : (remainingWeightLbs * 0.45359237);

    const compatibleMatches = partialLoads
        .filter((load) => {
            // Check physical trailer linear space constraints
            const fitsLinearSpace = (load.requiredLinearFeet || 0) <= remainingLinearFeet;

            // Check scalar weight capacity in lbs or kg
            const loadWeightLbs = load.requiredWeightLbs || (load.requiredWeightKg ? load.requiredWeightKg * 2.20462 : 0);
            const fitsWeightCapacity = loadWeightLbs <= remainingWeightLbs || (remainingWeightLbs === 0 && effectiveRemainingKg > 0);

            // Check timing / detour constraints
            const withinDelayTolerance = (load.estimatedDetourMinutes || 0) <= maxDelayMinutesTolerance;

            if (!fitsLinearSpace || !fitsWeightCapacity || !withinDelayTolerance) {
                return false;
            }

            // Enhanced CMVR Axle Statics check if requested or configured
            if (enforceCmvrLimits && (load.xPositionMeters !== undefined || load.requiredWeightKg || load.requiredWeightLbs)) {
                const itemWeightKg = load.requiredWeightKg || (load.requiredWeightLbs * 0.45359237);
                const statics = calculateAxleWeightDistribution(truckSpec, [
                    {
                        weightKg: itemWeightKg,
                        xPositionMeters: load.xPositionMeters !== undefined ? load.xPositionMeters : 2.0,
                        lengthMeters: load.lengthMeters || 2.0,
                    },
                ]);
                if (!statics.compliant) {
                    return false;
                }
            }

            return true;
        })
        .map((load) => {
            const linearFootUtilization = remainingLinearFeet > 0
                ? (load.requiredLinearFeet / remainingLinearFeet) * 100
                : 0;
            const weightUtilization = remainingWeightLbs > 0
                ? (load.requiredWeightLbs / remainingWeightLbs) * 100
                : 0;

            // Revenue efficiency score: payout relative to space used and detour time
            const detourMinutes = load.estimatedDetourMinutes || 0;
            const detourCost = (detourMinutes / 60) * 35; // ~$35/hr detour cost
            const payout = Number(load.payoutUSD || load.payoutINR || 0);
            const netIncrementalPayout = payout - detourCost;

            const loadWeightKg = load.requiredWeightKg || ((load.requiredWeightLbs || 0) * 0.45359237);

            // Calculate item-level CMVR axle metrics if position is available
            let axleCompliance = null;
            if (load.xPositionMeters !== undefined || enforceCmvrLimits) {
                const itemStatics = calculateAxleWeightDistribution(truckSpec, [
                    {
                        weightKg: loadWeightKg,
                        xPositionMeters: load.xPositionMeters !== undefined ? load.xPositionMeters : 3.0,
                        lengthMeters: load.lengthMeters || 2.0,
                    },
                ]);
                axleCompliance = {
                    compliant: itemStatics.compliant,
                    steerAxleWeightKg: itemStatics.steerAxle.weightKg,
                    bogieAxleWeightKg: itemStatics.bogieAxle.weightKg,
                    violations: itemStatics.violations,
                };
            }

            return {
                loadId: load.id,
                origin: load.origin,
                destination: load.destination,
                payoutUSD: load.payoutUSD,
                netIncrementalPayoutUSD: parseFloat(netIncrementalPayout.toFixed(2)),
                requiredLinearFeet: load.requiredLinearFeet,
                requiredWeightLbs: load.requiredWeightLbs,
                requiredWeightKg: parseFloat(loadWeightKg.toFixed(1)),
                estimatedDetourMinutes: load.estimatedDetourMinutes,
                spaceUtilizationImpact: {
                    linearFootPercentage: parseFloat(linearFootUtilization.toFixed(1)),
                    weightPercentage: parseFloat(weightUtilization.toFixed(1)),
                },
                ...(axleCompliance ? { axleCompliance } : {}),
            };
        });

    // Rank candidate matches by highest net incremental payout
    compatibleMatches.sort((a, b) => b.netIncrementalPayoutUSD - a.netIncrementalPayoutUSD);

    // Optional 3D LIFO verification on candidate combination
    let packingSummary = null;
    if (enforce3dLifo && compatibleMatches.length > 0) {
        const cargoItems = partialLoads.filter(p => compatibleMatches.some(m => m.loadId === p.id));
        packingSummary = pack3dLifoCargo(truck.trailerSpec || {}, cargoItems);
    }

    return {
        truckId: truck.id,
        availableCapacity: {
            remainingLinearFeet,
            remainingWeightLbs,
        },
        matchedCount: compatibleMatches.length,
        matches: compatibleMatches,
        ...(packingSummary ? { packingSummary } : {}),
    };
}

export {
    AxleWeightOptimizationService,
    defaultAxleWeightService,
    calculateAxleWeightDistribution,
    pack3dLifoCargo,
    calculateConsolidationYield,
    CMVR_AXLE_LIMITS_KG,
    CMVR_SAFETY_THRESHOLDS,
    DEFAULT_TRUCK_SPEC,
};
