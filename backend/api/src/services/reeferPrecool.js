/**
 * Thermodynamic Reefer Pre-Cooling & Cold-Chain Compliance Engine.
 * Implements non-linear heat decay (Newton's Law of Cooling), trailer insulation UA modeling,
 * commodity-specific temperature tolerances, and diesel fuel burn optimization.
 */

export const COMMODITY_PRESETS = {
    DEEP_FROZEN: {
        name: 'Deep Frozen (Seafood / Ice Cream)',
        targetSetPointF: -20,
        minSafeTempF: -30,
        maxSafeTempF: -10,
        sensitiveToChilling: false,
        recommendedMode: 'CONTINUOUS_PULLDOWN'
    },
    FROZEN: {
        name: 'Standard Frozen (Meat / Poultry)',
        targetSetPointF: 0,
        minSafeTempF: -10,
        maxSafeTempF: 10,
        sensitiveToChilling: false,
        recommendedMode: 'CONTINUOUS_PULLDOWN'
    },
    CHILLED_DAIRY: {
        name: 'Dairy Products & Milk',
        targetSetPointF: 36,
        minSafeTempF: 33, // Freezing hazard below 32°F
        maxSafeTempF: 40,
        sensitiveToChilling: true,
        recommendedMode: 'CYCLE_SENTRY'
    },
    PRODUCE_BERRIES: {
        name: 'Fresh Berries & Leafy Greens',
        targetSetPointF: 34,
        minSafeTempF: 32,
        maxSafeTempF: 38,
        sensitiveToChilling: true,
        recommendedMode: 'CYCLE_SENTRY'
    },
    BANANA_TROPICAL: {
        name: 'Bananas & Tropical Fruit',
        targetSetPointF: 56,
        minSafeTempF: 54, // Severe chilling injury below 54°F
        maxSafeTempF: 60,
        sensitiveToChilling: true,
        recommendedMode: 'CYCLE_SENTRY'
    },
    PHARMA_BIOLOGICS: {
        name: 'Pharmaceuticals & Biologics (2-8°C)',
        targetSetPointF: 39.2,
        minSafeTempF: 35.6,
        maxSafeTempF: 46.4,
        sensitiveToChilling: true,
        recommendedMode: 'CONTINUOUS_PULLDOWN'
    }
};

export const REEFER_SPECS = {
    continuousFuelBurnGalPerHour: 1.15,
    cycleSentryFuelBurnGalPerHour: 0.45,
    fuelPriceUSDPerGallon: 4.10,
    co2KgPerGallonDiesel: 10.18,
    standardTrailerVolumeCuFt: 3400,
};

/**
 * Backward-compatible linear pre-cooling evaluation.
 */
export function evaluateReeferPrecooling(params = {}) {
    const {
        reeferId,
        etaMinutes = 120,
        targetCargoTempF = 0,
        currentReeferTempF = 75,
        ambientWeatherTempF = 95
    } = params;

    const tempDelta = currentReeferTempF - targetCargoTempF;
    let estimatedCoolingMinutes = tempDelta > 0 ? tempDelta / 0.4 : 0;

    if (ambientWeatherTempF >= 85) {
        const heatMultiplier = 1 + ((ambientWeatherTempF - 85) * 0.015);
        estimatedCoolingMinutes *= heatMultiplier;
    }

    const requiredPrecoolMinutes = Math.min(240, Math.max(30, Math.ceil(estimatedCoolingMinutes + 15)));
    const shouldTriggerPrecool = etaMinutes <= requiredPrecoolMinutes && currentReeferTempF > targetCargoTempF;

    let telematicsCommand = null;
    if (shouldTriggerPrecool) {
        telematicsCommand = {
            action: 'START_PRECOOLING',
            reeferId,
            targetSetPointF: targetCargoTempF,
            mode: ambientWeatherTempF >= 85 ? 'CONTINUOUS_PULLDOWN' : 'CYCLE_SENTRY',
            commandIssuedAt: new Date().toISOString()
        };
    }

    return {
        reeferId,
        status: shouldTriggerPrecool ? 'PRECOOL_ACTIVE' : (currentReeferTempF <= targetCargoTempF ? 'AT_TEMPERATURE' : 'STANDBY'),
        metrics: {
            currentReeferTempF,
            targetCargoTempF,
            ambientWeatherTempF,
            etaMinutes,
            requiredPrecoolMinutes
        },
        telematicsCommand
    };
}

/**
 * Simulates non-linear pulldown temperature trajectory using Newton's law of cooling.
 * 
 * @param {Object} options
 * @returns {Object} Simulation trajectory, pulldown duration, fuel burn, and cost
 */
export function simulateThermodynamicPulldown(options = {}) {
    const {
        initialTempF = 75,
        targetTempF = 0,
        ambientTempF = 95,
        insulationRating = 'STANDARD', // 'HIGH_PERFORMANCE', 'STANDARD', 'AGED'
        reeferMode = 'CONTINUOUS_PULLDOWN',
        timeStepMinutes = 1
    } = options;

    if (initialTempF <= targetTempF) {
        return {
            pulldownMinutes: 0,
            targetReached: true,
            fuelBurnGallons: 0,
            fuelCostUSD: 0,
            co2EmissionsKg: 0,
            trajectory: [{ minute: 0, tempF: initialTempF }]
        };
    }

    // Thermal decay constant (k in min^-1) based on insulation quality
    let baseK = 0.018;
    if (insulationRating === 'HIGH_PERFORMANCE') baseK = 0.024;
    if (insulationRating === 'AGED') baseK = 0.013;

    // High ambient heat exerts higher thermal transmission load
    const ambientLoadFactor = ambientTempF > 80 ? 1 - ((ambientTempF - 80) * 0.005) : 1.0;
    const effectiveK = Math.max(0.008, baseK * ambientLoadFactor);

    let currentT = initialTempF;
    let elapsedMin = 0;
    const trajectory = [{ minute: 0, tempF: parseFloat(currentT.toFixed(1)) }];

    // As temperature approaches sub-zero, refrigeration compressor capacity drops
    while (currentT > targetTempF && elapsedMin < 360) {
        const subZeroPenalty = currentT < 20 ? (20 - currentT) * 0.0003 : 0;
        const netK = Math.max(0.005, effectiveK - subZeroPenalty);

        // Pulldown differential equation: dT/dt = -netK * (T - targetTempF)
        const deltaT = -netK * (currentT - (targetTempF - 10)) * timeStepMinutes;
        currentT = Math.max(targetTempF, currentT + deltaT);

        elapsedMin += timeStepMinutes;
        if (elapsedMin % 5 === 0 || currentT <= targetTempF) {
            trajectory.push({ minute: elapsedMin, tempF: parseFloat(currentT.toFixed(1)) });
        }
    }

    const burnRateGalPerHour = reeferMode === 'CONTINUOUS_PULLDOWN'
        ? REEFER_SPECS.continuousFuelBurnGalPerHour
        : REEFER_SPECS.cycleSentryFuelBurnGalPerHour;

    const fuelBurnGallons = parseFloat(((elapsedMin / 60) * burnRateGalPerHour).toFixed(2));
    const fuelCostUSD = parseFloat((fuelBurnGallons * REEFER_SPECS.fuelPriceUSDPerGallon).toFixed(2));
    const co2EmissionsKg = parseFloat((fuelBurnGallons * REEFER_SPECS.co2KgPerGallonDiesel).toFixed(1));

    return {
        pulldownMinutes: elapsedMin,
        targetReached: currentT <= targetTempF,
        finalTempF: parseFloat(currentT.toFixed(1)),
        fuelBurnGallons,
        fuelCostUSD,
        co2EmissionsKg,
        trajectory
    };
}

/**
 * Evaluates cold-chain precooling with commodity sensitivity, thermodynamic ETA matching,
 * and cost-optimal start time scheduling.
 * 
 * @param {Object} params
 * @returns {Object} Comprehensive precooling dispatch plan
 */
export function evaluatePrecoolWithThermodynamics(params = {}) {
    const {
        reeferId = 'REEFER-AUTO',
        commodityKey = 'FROZEN',
        customTargetTempF,
        currentReeferTempF = 75,
        ambientWeatherTempF = 90,
        etaMinutes = 120,
        insulationRating = 'STANDARD'
    } = params;

    const commodity = COMMODITY_PRESETS[commodityKey] || COMMODITY_PRESETS.FROZEN;
    const targetSetPointF = typeof customTargetTempF === 'number' ? customTargetTempF : commodity.targetSetPointF;

    // Run physics simulation
    const simulation = simulateThermodynamicPulldown({
        initialTempF: currentReeferTempF,
        targetTempF: targetSetPointF,
        ambientTempF: ambientWeatherTempF,
        insulationRating,
        reeferMode: ambientWeatherTempF >= 85 ? 'CONTINUOUS_PULLDOWN' : commodity.recommendedMode
    });

    const bufferMinutes = 15;
    const totalRequiredLeadTimeMinutes = simulation.pulldownMinutes + bufferMinutes;

    // Chilling injury check
    const chillingInjuryRisk = commodity.sensitiveToChilling && currentReeferTempF < commodity.minSafeTempF;

    // Optimal start trigger
    const shouldStartNow = etaMinutes <= totalRequiredLeadTimeMinutes && currentReeferTempF > targetSetPointF;
    const optimalStartMinutesFromNow = Math.max(0, etaMinutes - totalRequiredLeadTimeMinutes);

    return {
        reeferId,
        commodity: {
            key: commodityKey,
            name: commodity.name,
            targetSetPointF,
            minSafeTempF: commodity.minSafeTempF,
            maxSafeTempF: commodity.maxSafeTempF,
            sensitiveToChilling: commodity.sensitiveToChilling
        },
        status: shouldStartNow
            ? 'START_PRECOOL_NOW'
            : (currentReeferTempF <= targetSetPointF ? 'AT_SETPOINT' : 'SCHEDULED_STANDBY'),
        simulationMetrics: {
            currentReeferTempF,
            targetSetPointF,
            ambientWeatherTempF,
            etaMinutes,
            simulatedPulldownMinutes: simulation.pulldownMinutes,
            totalLeadTimeMinutes: totalRequiredLeadTimeMinutes,
            optimalStartMinutesFromNow,
            projectedFuelGallons: simulation.fuelBurnGallons,
            projectedFuelCostUSD: simulation.fuelCostUSD,
            projectedCO2Kg: simulation.co2EmissionsKg
        },
        chillingInjuryRisk,
        telematicsCommand: shouldStartNow ? {
            action: 'START_PRECOOLING',
            reeferId,
            targetSetPointF,
            mode: ambientWeatherTempF >= 85 ? 'CONTINUOUS_PULLDOWN' : commodity.recommendedMode,
            fuelBudgetGallons: simulation.fuelBurnGallons,
            commandIssuedAt: new Date().toISOString()
        } : null
    };
}

export default {
    evaluateReeferPrecooling,
    simulateThermodynamicPulldown,
    evaluatePrecoolWithThermodynamics,
    COMMODITY_PRESETS,
    REEFER_SPECS
};
