/**
 * Baseline rate multipliers per equipment type ($/mile baseline).
 */
const BASELINE_RATES_PER_MILE = {
    DRY_VAN: 2.35,
    REEFER: 2.85,
    FLATBED: 2.95,
    POWER_ONLY: 2.10
};

const NATIONAL_AVG_FUEL_PRICE = 3.90; // USD per gallon baseline

/**
 * Calculates Fair Market Value (FMV) for a given load based on live market factors.
 * 
 * @param {Object} load - { distanceMiles, equipmentType, currentOfferedPayout }
 * @param {Object} marketConditions - { truckToLoadRatio, localFuelPriceUSD }
 * @returns {Object} Fair market pricing analysis and negotiation counter-offer recommendation
 */
export function calculateFairMarketValue(load, marketConditions = {}) {
    const {
        distanceMiles = 0,
        equipmentType = 'DRY_VAN',
        currentOfferedPayout = 0
    } = load;

    const {
        truckToLoadRatio = 1.0, // < 1.0 indicates high demand / carrier market; > 1.0 indicates capacity surplus
        localFuelPriceUSD = NATIONAL_AVG_FUEL_PRICE
    } = marketConditions;

    const baseRatePerMile = BASELINE_RATES_PER_MILE[equipmentType.toUpperCase()] || BASELINE_RATES_PER_MILE.DRY_VAN;

    // Adjust rate based on truck-to-load capacity tightness
    // Low capacity (<1.0 ratio) increases market rate; High capacity (>1.0 ratio) lowers market rate
    let capacityFactor = 1.0;
    if (truckToLoadRatio < 0.8) {
        capacityFactor = 1.25; // Carrier market (+25%)
    } else if (truckToLoadRatio < 1.0) {
        capacityFactor = 1.12; // Tight capacity (+12%)
    } else if (truckToLoadRatio > 1.5) {
        capacityFactor = 0.90; // Loose capacity (-10%)
    }

    // Adjust rate based on fuel price surcharge
    const fuelDelta = localFuelPriceUSD - NATIONAL_AVG_FUEL_PRICE;
    const fuelSurchargePerMile = fuelDelta > 0 ? (fuelDelta / 6.5) : 0; // assuming 6.5 MPG

    const adjustedRatePerMile = (baseRatePerMile * capacityFactor) + fuelSurchargePerMile;
    const fairMarketValueUSD = distanceMiles * adjustedRatePerMile;

    const currentRatePerMile = distanceMiles > 0 ? currentOfferedPayout / distanceMiles : 0;
    const rateDifference = fairMarketValueUSD - currentOfferedPayout;

    // Gauge classification relative to market average
    let marketGauge = 'FAIR';
    if (currentOfferedPayout < fairMarketValueUSD * 0.9) {
        marketGauge = 'BELOW_MARKET';
    } else if (currentOfferedPayout > fairMarketValueUSD * 1.1) {
        marketGauge = 'ABOVE_MARKET';
    }

    // Counter-offer strategy: Fair market rate + 5% negotiation cushion if below market
    const recommendedCounterOfferUSD = currentOfferedPayout < fairMarketValueUSD
        ? Math.ceil(fairMarketValueUSD * 1.05)
        : currentOfferedPayout;

    return {
        loadDetails: {
            distanceMiles,
            equipmentType,
            offeredPayoutUSD: currentOfferedPayout,
            offeredRatePerMileUSD: parseFloat(currentRatePerMile.toFixed(2))
        },
        oracleValuation: {
            fairMarketValueUSD: parseFloat(fairMarketValueUSD.toFixed(2)),
            fairRatePerMileUSD: parseFloat(adjustedRatePerMile.toFixed(2)),
            marketGauge,
            recommendedCounterOfferUSD: parseFloat(recommendedCounterOfferUSD.toFixed(2)),
            potentialGainUSD: rateDifference > 0 ? parseFloat(rateDifference.toFixed(2)) : 0
        },
        marketFactorsApplied: {
            truckToLoadRatio,
            capacityMultiplier: capacityFactor,
            localFuelPriceUSD,
            fuelSurchargePerMileUSD: parseFloat(fuelSurchargePerMile.toFixed(2))
        }
    };
}
