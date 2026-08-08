/**
 * Evaluates spot market partial loads against a truck's available capacity and route parameters.
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
            const linearFootUtilization = (load.requiredLinearFeet / remainingLinearFeet) * 100;
            const weightUtilization = (load.requiredWeightLbs / remainingWeightLbs) * 100;

            // Revenue efficiency score: payout relative to space used and detour time
            const detourCost = (load.estimatedDetourMinutes / 60) * 35; // ~$35/hr detour cost
            const netIncrementalPayout = load.payoutUSD - detourCost;

            return {
                loadId: load.id,
                origin: load.origin,
                destination: load.destination,
                payoutUSD: load.payoutUSD,
                netIncrementalPayoutUSD: parseFloat(netIncrementalPayout.toFixed(2)),
                requiredLinearFeet: load.requiredLinearFeet,
                requiredWeightLbs: load.requiredWeightLbs,
                estimatedDetourMinutes: load.estimatedDetourMinutes,
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
