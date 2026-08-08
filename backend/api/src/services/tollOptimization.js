/**
 * Default economic baseline parameters for Class 8 / 5-Axle commercial trucks.
 */
const DEFAULT_CONFIG = {
    fuelPricePerGallon: 4.10,     # USD / gallon
    avgMpg: 6.5,                  # Average Miles Per Gallon for 5-axle heavy truck
    driverHourlyRate: 30.00,      # USD / hour (driver time value)
    axleMultiplier: 2.5           # Class 8 multi-axle toll multiplier relative to consumer cars
};

/**
 * Calculates total trip cost considering tolls, fuel consumption, and driver time.
 * @param {Object} params - { distanceMiles, estimatedTimeHours, tollCostUSD, fuelPrice, mpg, driverHourlyRate }
 * @returns {Object} Cost breakdown including total operational cost.
 */
export function calculateRouteOperatingCost({
    distanceMiles,
    estimatedTimeHours,
    tollCostUSD = 0,
    fuelPrice = DEFAULT_CONFIG.fuelPricePerGallon,
    mpg = DEFAULT_CONFIG.avgMpg,
    driverHourlyRate = DEFAULT_CONFIG.driverHourlyRate
}) {
    const fuelGallonsUsed = distanceMiles / mpg;
    const fuelCost = fuelGallonsUsed * fuelPrice;
    const timeCost = estimatedTimeHours * driverHourlyRate;
    const totalCost = fuelCost + timeCost + tollCostUSD;

    return {
        distanceMiles,
        estimatedTimeHours,
        fuelGallonsUsed: parseFloat(fuelGallonsUsed.toFixed(2)),
        fuelCostUSD: parseFloat(fuelCost.toFixed(2)),
        timeCostUSD: parseFloat(timeCost.toFixed(2)),
        tollCostUSD: parseFloat(tollCostUSD.toFixed(2)),
        totalCostUSD: parseFloat(totalCost.toFixed(2))
    };
}

/**
 * Evaluates candidate routes and ranks them by highest profit margin / lowest total cost.
 * @param {Array} routes - Array of candidate routes with distance, time, and toll data.
 * @param {Object} loadDetails - { grossPayoutUSD, axleCount, fuelPrice, driverHourlyRate }
 * @returns {Object} Optimized routes ranking with profit recommendation.
 */
export function optimizeTollRoutes(routes, loadDetails = {}) {
    const { grossPayoutUSD = 0, axleCount = 5 } = loadDetails;
    const axleMultiplier = axleCount >= 5 ? DEFAULT_CONFIG.axleMultiplier : 1.0;

    const evaluatedRoutes = routes.map((route) => {
        // Apply axle multiplier to standard base toll
        const commercialToll = (route.baseTollUSD || 0) * axleMultiplier;

        const costMetrics = calculateRouteOperatingCost({
            distanceMiles: route.distanceMiles,
            estimatedTimeHours: route.estimatedTimeHours,
            tollCostUSD: commercialToll,
            fuelPrice: loadDetails.fuelPrice,
            mpg: loadDetails.mpg,
            driverHourlyRate: loadDetails.driverHourlyRate
        });

        const netProfitUSD = grossPayoutUSD > 0 ? grossPayoutUSD - costMetrics.totalCostUSD : 0;

        return {
            routeId: route.id || route.name,
            routeName: route.name,
            isTollRoute: commercialToll > 0,
            costBreakdown: costMetrics,
            estimatedNetProfitUSD: parseFloat(netProfitUSD.toFixed(2))
        };
    });

    // Sort by lowest total operational cost (highest profit margin)
    evaluatedRoutes.sort((a, b) => a.costBreakdown.totalCostUSD - b.costBreakdown.totalCostUSD);

    const recommendedRoute = evaluatedRoutes[0];
    const fastestRoute = [...evaluatedRoutes].sort((a, b) => a.costBreakdown.estimatedTimeHours - b.costBreakdown.estimatedTimeHours)[0];

    const potentialSavingsUSD = parseFloat((fastestRoute.costBreakdown.totalCostUSD - recommendedRoute.costBreakdown.totalCostUSD).toFixed(2));

    return {
        recommendedRoute,
        allCandidateRoutes: evaluatedRoutes,
        optimizationSummary: {
            highestProfitRouteId: recommendedRoute.routeId,
            fastestRouteId: fastestRoute.routeId,
            potentialSavingsUSD: potentialSavingsUSD > 0 ? potentialSavingsUSD : 0
        }
    };
}
