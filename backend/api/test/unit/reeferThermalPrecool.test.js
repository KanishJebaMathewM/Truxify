import assert from 'node:assert';
import {
    evaluateReeferPrecooling,
    simulateThermodynamicPulldown,
    evaluatePrecoolWithThermodynamics,
    COMMODITY_PRESETS,
    REEFER_SPECS
} from '../../src/services/reeferPrecool.js';

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
    } catch (err) {
        console.error(`  ✗ ${name}:`, err.message);
        throw err;
    }
}

console.log('--- Running Reefer Thermodynamic Precool & Cold-Chain Tests ---');

await test('validates cold-chain commodity profiles and critical chilling thresholds', () => {
    assert.ok(COMMODITY_PRESETS.DEEP_FROZEN);
    assert.strictEqual(COMMODITY_PRESETS.DEEP_FROZEN.targetSetPointF, -20);

    // Chilled dairy freezing damage prevention
    assert.ok(COMMODITY_PRESETS.CHILLED_DAIRY.sensitiveToChilling);
    assert.strictEqual(COMMODITY_PRESETS.CHILLED_DAIRY.minSafeTempF, 33);

    // Tropical bananas: chilling injury if cooled below 54°F
    assert.strictEqual(COMMODITY_PRESETS.BANANA_TROPICAL.minSafeTempF, 54);
    assert.ok(COMMODITY_PRESETS.BANANA_TROPICAL.sensitiveToChilling);

    // Pharma / Biologics: 2-8°C
    assert.strictEqual(COMMODITY_PRESETS.PHARMA_BIOLOGICS.targetSetPointF, 39.2);
});

await test('simulates thermodynamic non-linear pulldown with Newton cooling decay', () => {
    const simulation = simulateThermodynamicPulldown({
        initialTempF: 75,
        targetTempF: 0,
        ambientTempF: 90,
        insulationRating: 'STANDARD'
    });

    assert.strictEqual(simulation.targetReached, true);
    assert.ok(simulation.pulldownMinutes > 0);
    assert.ok(simulation.fuelBurnGallons > 0);
    assert.ok(simulation.fuelCostUSD > 0);
    assert.ok(simulation.co2EmissionsKg > 0);
    assert.ok(simulation.trajectory.length > 2);

    // Initial point must be 75°F and final point <= 0°F
    assert.strictEqual(simulation.trajectory[0].tempF, 75);
    assert.ok(simulation.trajectory[simulation.trajectory.length - 1].tempF <= 0);
});

await test('simulates slower pulldown in high ambient summer heat vs mild weather', () => {
    const hotSummer = simulateThermodynamicPulldown({
        initialTempF: 80,
        targetTempF: -10,
        ambientTempF: 105, // 105°F heatwave
    });

    const mildSpring = simulateThermodynamicPulldown({
        initialTempF: 80,
        targetTempF: -10,
        ambientTempF: 65,  // 65°F spring day
    });

    // Extreme ambient heat requires more time and fuel to reach -10°F
    assert.ok(hotSummer.pulldownMinutes >= mildSpring.pulldownMinutes);
    assert.ok(hotSummer.fuelBurnGallons >= mildSpring.fuelBurnGallons);
});

await test('returns zero pulldown when reefer is already at or below target temperature', () => {
    const result = simulateThermodynamicPulldown({
        initialTempF: -15,
        targetTempF: -10
    });

    assert.strictEqual(result.pulldownMinutes, 0);
    assert.strictEqual(result.fuelBurnGallons, 0);
    assert.strictEqual(result.fuelCostUSD, 0);
});

await test('evaluates comprehensive cold-chain plan and schedules precooling start time', () => {
    const plan = evaluatePrecoolWithThermodynamics({
        reeferId: 'REEFER-900',
        commodityKey: 'DEEP_FROZEN',
        currentReeferTempF: 70,
        ambientWeatherTempF: 95,
        etaMinutes: 180
    });

    assert.strictEqual(plan.reeferId, 'REEFER-900');
    assert.strictEqual(plan.commodity.targetSetPointF, -20);
    assert.ok(plan.simulationMetrics.simulatedPulldownMinutes > 0);
    assert.ok(plan.simulationMetrics.totalLeadTimeMinutes > 0);
    assert.ok(typeof plan.simulationMetrics.optimalStartMinutesFromNow === 'number');
});

await test('flags chilling injury hazard when sensitive commodity is exposed to sub-critical temperatures', () => {
    const sensitiveLoad = evaluatePrecoolWithThermodynamics({
        reeferId: 'REEFER-BANANA',
        commodityKey: 'BANANA_TROPICAL',
        currentReeferTempF: 45, // 45°F is below min safe 54°F!
        ambientWeatherTempF: 80,
        etaMinutes: 60
    });

    assert.strictEqual(sensitiveLoad.chillingInjuryRisk, true);
});

await test('preserves exact backward compatibility of evaluateReeferPrecooling', () => {
    const hotResult = evaluateReeferPrecooling({
        reeferId: 'R-1',
        etaMinutes: 60,
        targetCargoTempF: -10,
        currentReeferTempF: 75,
        ambientWeatherTempF: 95
    });

    assert.strictEqual(hotResult.status, 'PRECOOL_ACTIVE');
    assert.strictEqual(hotResult.telematicsCommand.mode, 'CONTINUOUS_PULLDOWN');

    const coolResult = evaluateReeferPrecooling({
        reeferId: 'R-2',
        etaMinutes: 45,
        targetCargoTempF: 34,
        currentReeferTempF: 65,
        ambientWeatherTempF: 72
    });

    assert.strictEqual(coolResult.status, 'PRECOOL_ACTIVE');
    assert.strictEqual(coolResult.telematicsCommand.mode, 'CYCLE_SENTRY');
});

console.log('\n🎉 All Reefer Thermodynamic Precool & Cold-Chain tests passed successfully!\n');
