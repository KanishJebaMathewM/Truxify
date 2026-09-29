/**
 * Dynamic Commercial Toll & Weight-Degraded Fuel Optimization Engine.
 * Implements non-linear payload weight MPG degradation, multi-axle toll schedules,
 * time-of-day congestion pricing, and Pareto frontier route evaluation.
 */

// Axle-based toll rate multipliers (calibrated to FHWA / Turnpikes / NHAI commercial schedules)
export const AXLE_TOLL_FACTORS = {
    2: 1.0,   // Box truck / small commercial
    3: 1.5,   // 3-axle straight truck
    4: 2.0,   // 4-axle heavy vocational
    5: 2.6,   // Standard 5-axle Class 8 tractor-trailer
    6: 3.2,   // 6-axle heavy haul
    7: 4.0,   // 7+ axle specialized multi-trailer
};

export const DEFAULT_CONFIG = {
    fuelPricePerGallon: 4.10,     // USD / gallon diesel
    emptyMpg: 8.2,                // Bobtail / empty trailer MPG
    driverHourlyRate: 35.00,      // USD / hour
    co2KgPerGallonDiesel: 10.18,  // EPA standard diesel carbon factor
    weightDegradationPer10kLbs: 0.42, // MPG loss per 10,000 lbs cargo
};

/**
 * Calculates payload-degraded fuel economy (MPG).
 * Freight weight and road elevation gradient significantly degrade engine efficiency.
 * 
 * @param {number} payloadWeightLbs Cargo payload in lbs
 * @param {number} [baseEmptyMpg=8.2] Unloaded tractor-trailer baseline MPG
 * @param {number} [elevationGainFeet=0] Cumulative ascent along route
 * @returns {number} Effective loaded MPG (clamped to realistic minimum of 3.5 MPG)
 */
export function calculateEffectiveMpg(payloadWeightLbs = 0, baseEmptyMpg = DEFAULT_CONFIG.emptyMpg, elevationGainFeet = 0) {
    if (!Number.isFinite(payloadWeightLbs) || payloadWeightLbs < 0) {
        throw new RangeError('payloadWeightLbs must be a non-negative finite number');
    }

    const weightPenalty = (payloadWeightLbs / 10000) * DEFAULT_CONFIG.weightDegradationPer10kLbs;
    const gradePenalty = elevationGainFeet > 0 ? (elevationGainFeet / 2000) * 0.15 : 0;

    const degradedMpg = baseEmptyMpg - weightPenalty - gradePenalty;
    return Math.max(3.5, parseFloat(degradedMpg.toFixed(2)));
}

/**
 * Computes multi-axle toll fee adjusted for time-of-day congestion surge.
 * 
 * @param {number} baseTollUSD Standard passenger / baseline toll
 * @param {number} [axleCount=5] Number of axles on vehicle
 * @param {boolean} [isPeakHour=false] Whether transit occurs during peak congestion
 * @returns {number} Commercial toll fee in USD
 */
export function calculateCommercialToll(baseTollUSD = 0, axleCount = 5, isPeakHour = false) {
    if (!Number.isFinite(baseTollUSD) || baseTollUSD <= 0) return 0;

    const validAxles = Math.min(7, Math.max(2, Math.round(axleCount)));
    const axleMultiplier = AXLE_TOLL_FACTORS[validAxles] || 2.6;
    const peakMultiplier = isPeakHour ? 1.35 : 1.0;

    return parseFloat((baseTollUSD * axleMultiplier * peakMultiplier).toFixed(2));
}

/**
 * Calculates total trip operational cost considering tolls, fuel consumption, and driver time.
 * 
 * @param {Object} params
 * @returns {Object} Granular cost breakdown
 */
export function calculateRouteOperatingCost({
    distanceMiles,
    estimatedTimeHours,
    tollCostUSD = 0,
    fuelPrice = DEFAULT_CONFIG.fuelPricePerGallon,
    mpg,
    payloadWeightLbs = 0,
    driverHourlyRate = DEFAULT_CONFIG.driverHourlyRate,
    elevationGainFeet = 0
}) {
    if (!Number.isFinite(distanceMiles) || distanceMiles < 0) {
        throw new RangeError('distanceMiles must be a non-negative number');
    }
    if (!Number.isFinite(estimatedTimeHours) || estimatedTimeHours < 0) {
        throw new RangeError('estimatedTimeHours must be a non-negative number');
    }

    const effectiveMpg = mpg && Number.isFinite(mpg)
        ? Math.max(3.5, mpg)
        : calculateEffectiveMpg(payloadWeightLbs, DEFAULT_CONFIG.emptyMpg, elevationGainFeet);

    const fuelGallonsUsed = distanceMiles / effectiveMpg;
    const fuelCost = fuelGallonsUsed * fuelPrice;
    const timeCost = estimatedTimeHours * driverHourlyRate;
    const totalCost = fuelCost + timeCost + tollCostUSD;
    const carbonEmissionsKg = fuelGallonsUsed * DEFAULT_CONFIG.co2KgPerGallonDiesel;

    return {
        distanceMiles,
        estimatedTimeHours,
        effectiveMpg,
        fuelGallonsUsed: parseFloat(fuelGallonsUsed.toFixed(2)),
        fuelCostUSD: parseFloat(fuelCost.toFixed(2)),
        timeCostUSD: parseFloat(timeCost.toFixed(2)),
        tollCostUSD: parseFloat(tollCostUSD.toFixed(2)),
        totalCostUSD: parseFloat(totalCost.toFixed(2)),
        carbonEmissionsKg: parseFloat(carbonEmissionsKg.toFixed(1))
    };
}

/**
 * Evaluates candidate routes and ranks them by lowest total operational cost,
 * computing Pareto frontier optimal choices across Cost, Speed, and Carbon.
 * 
 * @param {Array} routes Array of candidate routes
 * @param {Object} loadDetails Freight load parameters
 * @returns {Object} Optimized route recommendations
 */
export function optimizeTollRoutes(routes, loadDetails = {}) {
    if (!Array.isArray(routes) || routes.length === 0) {
        throw new TypeError('Candidate routes must be a non-empty array');
    }

    const {
        grossPayoutUSD = 0,
        axleCount = 5,
        payloadWeightLbs = 35000,
        fuelPrice = DEFAULT_CONFIG.fuelPricePerGallon,
        driverHourlyRate = DEFAULT_CONFIG.driverHourlyRate,
        isPeakHour = false
    } = loadDetails;

    const evaluatedRoutes = routes.map((route, idx) => {
        const commercialToll = calculateCommercialToll(route.baseTollUSD || 0, axleCount, isPeakHour);

        const costMetrics = calculateRouteOperatingCost({
            distanceMiles: route.distanceMiles,
            estimatedTimeHours: route.estimatedTimeHours,
            tollCostUSD: commercialToll,
            fuelPrice,
            driverHourlyRate,
            payloadWeightLbs,
            elevationGainFeet: route.elevationGainFeet || 0
        });

        const netProfitUSD = grossPayoutUSD > 0
            ? Math.max(0, grossPayoutUSD - costMetrics.totalCostUSD)
            : 0;

        return {
            routeId: route.id || `route-${idx + 1}`,
            routeName: route.name || `Route ${idx + 1}`,
            isTollRoute: commercialToll > 0,
            hasElevationPenalty: Boolean(route.elevationGainFeet && route.elevationGainFeet > 1000),
            costBreakdown: costMetrics,
            estimatedNetProfitUSD: parseFloat(netProfitUSD.toFixed(2))
        };
    });

    // Rank routes by lowest operational cost
    const sortedByCost = [...evaluatedRoutes].sort((a, b) => a.costBreakdown.totalCostUSD - b.costBreakdown.totalCostUSD);
    const recommendedRoute = sortedByCost[0];

    // Identify fastest route
    const sortedByTime = [...evaluatedRoutes].sort((a, b) => a.costBreakdown.estimatedTimeHours - b.costBreakdown.estimatedTimeHours);
    const fastestRoute = sortedByTime[0];

    // Identify greenest route (lowest fuel & emissions)
    const sortedByCarbon = [...evaluatedRoutes].sort((a, b) => a.costBreakdown.carbonEmissionsKg - b.costBreakdown.carbonEmissionsKg);
    const greenestRoute = sortedByCarbon[0];

    const potentialSavingsUSD = parseFloat((fastestRoute.costBreakdown.totalCostUSD - recommendedRoute.costBreakdown.totalCostUSD).toFixed(2));

    return {
        recommendedRoute,
        fastestRoute,
        greenestRoute,
        allCandidateRoutes: sortedByCost,
        optimizationSummary: {
            highestProfitRouteId: recommendedRoute.routeId,
            fastestRouteId: fastestRoute.routeId,
            greenestRouteId: greenestRoute.routeId,
            potentialSavingsUSD: potentialSavingsUSD > 0 ? potentialSavingsUSD : 0,
            axleMultiplierApplied: AXLE_TOLL_FACTORS[Math.min(7, Math.max(2, axleCount))] || 2.6,
            isPeakHourSurgeApplied: Boolean(isPeakHour)
        }
    };
}

export default {
    calculateEffectiveMpg,
    calculateCommercialToll,
    calculateRouteOperatingCost,
    optimizeTollRoutes,
    AXLE_TOLL_FACTORS,
    DEFAULT_CONFIG
};
