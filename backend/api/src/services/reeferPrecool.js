/**
 * Evaluates reefer pre-cooling timeline based on ETA to shipper, ambient outdoor temperature,
 * and cargo temperature requirements.
 * 
 * @param {Object} params - { reeferId, etaMinutes, targetCargoTempF, currentReeferTempF, ambientWeatherTempF }
 * @returns {Object} Pre-cooling evaluation status and telematics dispatch command
 */
export function evaluateReeferPrecooling(params) {
    const {
        reeferId,
        etaMinutes = 120,
        targetCargoTempF = 0, // e.g. frozen load at 0°F
        currentReeferTempF = 75,
        ambientWeatherTempF = 95
    } = params;

    const tempDelta = currentReeferTempF - targetCargoTempF;

    // Base cooling rate: approx 0.4°F reduction per minute under normal conditions
    let estimatedCoolingMinutes = tempDelta > 0 ? tempDelta / 0.4 : 0;

    // Adjust cooling time for high ambient heat (e.g. > 85°F increases required run time)
    if (ambientWeatherTempF >= 85) {
        const heatMultiplier = 1 + ((ambientWeatherTempF - 85) * 0.015);
        estimatedCoolingMinutes *= heatMultiplier;
    }

    // Safety buffer for air circulation and humidity stabilization
    const requiredPrecoolMinutes = Math.min(240, Math.max(30, Math.ceil(estimatedCoolingMinutes + 15)));

    // Trigger precool if ETA is within required lead time and trailer is not at temperature
    const shouldTriggerPrecool = etaMinutes <= requiredPrecoolMinutes && currentReeferTempF > targetCargoTempF;

    let telematicsCommand = null;
    if (shouldTriggerPrecool) {
        telematicsCommand = {
            action: 'START_PRECOOLING',
            reeferId,
            targetSetPointF: targetCargoTempF,
            // Use Continuous mode in extreme heat (>85°F) for rapid pulldown; Cycle-Sentry for moderate weather
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
