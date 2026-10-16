/**
 * HAZMAT Class Compatibility Matrix
 * Incompatible combinations cannot be co-loaded on the same freight manifest.
 */
export const HAZMAT_INCOMPATIBILITY_RULES = {
    FOOD_GRADE: ['CORROSIVE_8', 'POISON_6', 'FLAMMABLE_3', 'RADIOACTIVE_7'],
    CORROSIVE_8: ['FOOD_GRADE', 'FLAMMABLE_3', 'EXPLOSIVE_1'],
    POISON_6: ['FOOD_GRADE', 'PHARMACEUTICAL'],
    FLAMMABLE_3: ['FOOD_GRADE', 'CORROSIVE_8', 'OXIDIZER_5'],
    PHARMACEUTICAL: ['POISON_6', 'CORROSIVE_8'],
};

/**
 * Checks if candidate loads have conflicting HAZMAT or sanitary requirements.
 * @param {Array<string>} commodityTypes
 * @returns {boolean} True if all commodities are mutually compatible
 */
export function validateCommodityCompatibility(commodityTypes = []) {
    const types = commodityTypes.filter(Boolean);
    for (let i = 0; i < types.length; i++) {
        const typeA = types[i];
        const forbidden = HAZMAT_INCOMPATIBILITY_RULES[typeA] || [];
        for (let j = i + 1; j < types.length; j++) {
            const typeB = types[j];
            if (forbidden.includes(typeB)) {
                return false;
            }
        }
    }
    return true;
}

/**
 * Evaluates spot market partial loads against a truck's available capacity and route parameters.
 * Backward-compatible single-load ranking.
 * 
 * @param {Object} truck - { id, currentRoute, remainingLinearFeet, remainingWeightLbs, maxDelayMinutesTolerance }
 * @param {Array} partialLoads - Array of candidate LTL loads from spot market
 * @returns {Object} Matching results ranked by profitability and compatibility
 */
export function matchLtlPartialLoads(truck, partialLoads = []) {
    const {
        remainingLinearFeet = 0,
        remainingWeightLbs = 0,
        maxDelayMinutesTolerance = 60
    } = truck;

    const compatibleMatches = partialLoads
        .filter((load) => {
            // Check physical trailer space constraints
            const fitsLinearSpace = load.requiredLinearFeet <= remainingLinearFeet;
            const fitsWeightCapacity = load.requiredWeightLbs <= remainingWeightLbs;

            // Check timing / detour constraints
            const withinDelayTolerance = (load.estimatedDetourMinutes || 0) <= maxDelayMinutesTolerance;

            return fitsLinearSpace && fitsWeightCapacity && withinDelayTolerance;
        })
        .map((load) => {
            const linearFootUtilization = remainingLinearFeet > 0
                ? (load.requiredLinearFeet / remainingLinearFeet) * 100
                : 0;
            const weightUtilization = remainingWeightLbs > 0
                ? (load.requiredWeightLbs / remainingWeightLbs) * 100
                : 0;

            // Revenue efficiency score: payout relative to space used and detour time
            const detourCost = ((load.estimatedDetourMinutes || 0) / 60) * 35; // ~$35/hr detour cost
            const netIncrementalPayout = load.payoutUSD - detourCost;

            return {
                loadId: load.id,
                origin: load.origin,
                destination: load.destination,
                commodityType: load.commodityType || 'GENERAL_FREIGHT',
                payoutUSD: load.payoutUSD,
                netIncrementalPayoutUSD: parseFloat(netIncrementalPayout.toFixed(2)),
                requiredLinearFeet: load.requiredLinearFeet,
                requiredWeightLbs: load.requiredWeightLbs,
                estimatedDetourMinutes: load.estimatedDetourMinutes || 0,
                spaceUtilizationImpact: {
                    linearFootPercentage: parseFloat(linearFootUtilization.toFixed(1)),
                    weightPercentage: parseFloat(weightUtilization.toFixed(1))
                }
            };
        });

    // Rank candidate matches by highest net incremental payout
    compatibleMatches.sort((a, b) => b.netIncrementalPayoutUSD - a.netIncrementalPayoutUSD);

    return {
        truckId: truck.id,
        availableCapacity: {
            remainingLinearFeet,
            remainingWeightLbs
        },
        matchedCount: compatibleMatches.length,
        matches: compatibleMatches
    };
}

/**
 * Computes optimal LTL bundle using 2D Knapsack branch-and-bound optimization
 * subject to trailer linear feet, max weight, detour tolerance, and HAZMAT segregation rules.
 * 
 * @param {Object} truck
 * @param {Array} partialLoads
 * @param {Object} options
 * @returns {Object} Optimal consolidated load manifest
 */
export function optimizeLtlConsolidationKnapsack(truck, partialLoads = [], options = {}) {
    if (!truck || typeof truck !== 'object') {
        throw new TypeError('Valid truck object is required');
    }
    if (!Array.isArray(partialLoads)) {
        throw new TypeError('partialLoads must be an array');
    }

    const {
        id: truckId = 'UNKNOWN',
        remainingLinearFeet = 0,
        remainingWeightLbs = 0,
        maxDelayMinutesTolerance = 60,
    } = truck;

    if (remainingLinearFeet <= 0 || remainingWeightLbs <= 0) {
        return {
            truckId,
            optimalBundle: [],
            totalGrossPayoutUSD: 0,
            totalNetPayoutUSD: 0,
            totalLinearFeetUsed: 0,
            totalWeightLbsUsed: 0,
            totalDetourMinutes: 0,
            capacityUtilization: { linearFootPercentage: 0, weightPercentage: 0 },
            highFillRateBonusUSD: 0,
            stopSequence: [],
            hazmatCertified: true,
            status: 'NO_CAPACITY'
        };
    }

    // Filter strictly out-of-bounds candidates first
    const candidates = partialLoads.filter(load =>
        load &&
        typeof load.payoutUSD === 'number' &&
        load.payoutUSD > 0 &&
        typeof load.requiredLinearFeet === 'number' &&
        load.requiredLinearFeet > 0 &&
        load.requiredLinearFeet <= remainingLinearFeet &&
        typeof load.requiredWeightLbs === 'number' &&
        load.requiredWeightLbs > 0 &&
        load.requiredWeightLbs <= remainingWeightLbs &&
        (load.estimatedDetourMinutes || 0) <= maxDelayMinutesTolerance
    ).map(load => {
        const detourMin = load.estimatedDetourMinutes || 0;
        const detourCost = (detourMin / 60) * 35;
        const netPayout = Math.max(0, load.payoutUSD - detourCost);
        return {
            ...load,
            estimatedDetourMinutes: detourMin,
            netPayoutUSD: parseFloat(netPayout.toFixed(2)),
            commodityType: load.commodityType || 'GENERAL_FREIGHT'
        };
    });

    if (candidates.length === 0) {
        return {
            truckId,
            optimalBundle: [],
            totalGrossPayoutUSD: 0,
            totalNetPayoutUSD: 0,
            totalLinearFeetUsed: 0,
            totalWeightLbsUsed: 0,
            totalDetourMinutes: 0,
            capacityUtilization: { linearFootPercentage: 0, weightPercentage: 0 },
            highFillRateBonusUSD: 0,
            stopSequence: [],
            hazmatCertified: true,
            status: 'NO_FEASIBLE_LOADS'
        };
    }

    // Knapsack branch-and-bound exploration with pruning
    // Sort descending by profit-to-space density (heuristic upper bound)
    candidates.sort((a, b) => (b.netPayoutUSD / b.requiredLinearFeet) - (a.netPayoutUSD / a.requiredLinearFeet));

    let bestNetProfit = -1;
    let bestBundle = [];

    function search(index, currentFeet, currentWeight, currentDetour, currentNetPayout, currentLoads) {
        if (currentNetPayout > bestNetProfit) {
            bestNetProfit = currentNetPayout;
            bestBundle = [...currentLoads];
        }

        if (index >= candidates.length) return;

        // Bounding check: Calculate optimistic upper bound for remaining items
        let upperBound = currentNetPayout;
        for (let i = index; i < candidates.length; i++) {
            upperBound += candidates[i].netPayoutUSD;
        }
        if (upperBound <= bestNetProfit) return;

        const item = candidates[index];

        // Feasibility check for adding item
        const nextFeet = currentFeet + item.requiredLinearFeet;
        const nextWeight = currentWeight + item.requiredWeightLbs;
        const nextDetour = currentDetour + item.estimatedDetourMinutes;

        if (
            nextFeet <= remainingLinearFeet &&
            nextWeight <= remainingWeightLbs &&
            nextDetour <= maxDelayMinutesTolerance
        ) {
            // Check HAZMAT compatibility with existing bundle
            const proposedCommodities = [...currentLoads.map(l => l.commodityType), item.commodityType];
            if (validateCommodityCompatibility(proposedCommodities)) {
                currentLoads.push(item);
                search(index + 1, nextFeet, nextWeight, nextDetour, currentNetPayout + item.netPayoutUSD, currentLoads);
                currentLoads.pop();
            }
        }

        // Branch without item
        search(index + 1, currentFeet, currentWeight, currentDetour, currentNetPayout, currentLoads);
    }

    search(0, 0, 0, 0, 0, []);

    // Calculate aggregate metrics for best bundle
    const totalGrossPayoutUSD = parseFloat(bestBundle.reduce((sum, l) => sum + l.payoutUSD, 0).toFixed(2));
    const totalLinearFeetUsed = bestBundle.reduce((sum, l) => sum + l.requiredLinearFeet, 0);
    const totalWeightLbsUsed = bestBundle.reduce((sum, l) => sum + l.requiredWeightLbs, 0);
    const totalDetourMinutes = bestBundle.reduce((sum, l) => sum + (l.estimatedDetourMinutes || 0), 0);

    const linearFootPercentage = parseFloat(((totalLinearFeetUsed / remainingLinearFeet) * 100).toFixed(1));
    const weightPercentage = parseFloat(((totalWeightLbsUsed / remainingWeightLbs) * 100).toFixed(1));

    // High Fill-Rate Efficiency Bonus (5% bonus when trailer utilization >= 80%)
    let highFillRateBonusUSD = 0;
    if (linearFootPercentage >= 80.0 || weightPercentage >= 80.0) {
        highFillRateBonusUSD = parseFloat((totalGrossPayoutUSD * 0.05).toFixed(2));
    }

    const totalNetPayoutUSD = parseFloat((bestNetProfit + highFillRateBonusUSD).toFixed(2));

    // LIFO Delivery Sequencing (Last loaded drops off first)
    // Order dropoffs by furthest destination or priority
    const stopSequence = bestBundle.map((load, i) => ({
        sequenceNumber: i + 1,
        type: 'DROPOFF',
        loadId: load.id,
        destination: load.destination || `STOP-${i + 1}`,
        unloadingFeet: load.requiredLinearFeet,
        unloadingWeightLbs: load.requiredWeightLbs,
        estimatedDetourMinutes: load.estimatedDetourMinutes || 0
    }));

    return {
        truckId,
        optimalBundle: bestBundle.map(l => ({
            loadId: l.id,
            origin: l.origin,
            destination: l.destination,
            commodityType: l.commodityType,
            requiredLinearFeet: l.requiredLinearFeet,
            requiredWeightLbs: l.requiredWeightLbs,
            payoutUSD: l.payoutUSD,
            netPayoutUSD: l.netPayoutUSD,
            estimatedDetourMinutes: l.estimatedDetourMinutes
        })),
        totalGrossPayoutUSD,
        totalNetPayoutUSD,
        totalLinearFeetUsed,
        totalWeightLbsUsed,
        totalDetourMinutes,
        capacityUtilization: {
            linearFootPercentage,
            weightPercentage
        },
        highFillRateBonusUSD,
        stopSequence,
        hazmatCertified: true,
        status: bestBundle.length > 0 ? 'OPTIMAL' : 'NO_FEASIBLE_LOADS'
    };
}

export default {
    matchLtlPartialLoads,
    optimizeLtlConsolidationKnapsack,
    validateCommodityCompatibility,
    HAZMAT_INCOMPATIBILITY_RULES
};
