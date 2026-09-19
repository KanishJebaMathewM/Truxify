import assert from 'node:assert';
import {
    calculateEffectiveMpg,
    calculateCommercialToll,
    calculateRouteOperatingCost,
    optimizeTollRoutes,
    AXLE_TOLL_FACTORS,
    DEFAULT_CONFIG
} from '../../src/services/tollOptimization.js';

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
    } catch (err) {
        console.error(`  ✗ ${name}:`, err.message);
        throw err;
    }
}

console.log('--- Running Commercial Toll & Weight-Fuel Optimization Tests ---');

await test('calculates non-linear fuel degradation as cargo payload increases', () => {
    // Empty truck: 0 lbs -> 8.2 MPG
    const emptyMpg = calculateEffectiveMpg(0);
    assert.strictEqual(emptyMpg, 8.2);

    // 20,000 lbs load: 8.2 - 2 * 0.42 = 7.36 MPG
    const mediumMpg = calculateEffectiveMpg(20000);
    assert.strictEqual(mediumMpg, 7.36);

    // 40,000 lbs load: 8.2 - 4 * 0.42 = 6.52 MPG
    const heavyMpg = calculateEffectiveMpg(40000);
    assert.strictEqual(heavyMpg, 6.52);

    // Heavy load consumes significantly more fuel per mile than empty truck
    assert.ok(emptyMpg > heavyMpg);
});

await test('degrades fuel economy further when encountering steep elevation gain', () => {
    const flatMpg = calculateEffectiveMpg(30000, 8.2, 0);
    const mountainMpg = calculateEffectiveMpg(30000, 8.2, 4000); // 4,000 ft mountain climb

    assert.ok(flatMpg > mountainMpg);
    // 4000 ft elevation penalty is (4000 / 2000) * 0.15 = 0.3 MPG
    assert.strictEqual(parseFloat((flatMpg - mountainMpg).toFixed(2)), 0.3);
});

await test('scales commercial toll rates by axle count hierarchy', () => {
    const baseToll = 10.00;

    // 2-axle box truck: 1.0x -> $10.00
    assert.strictEqual(calculateCommercialToll(baseToll, 2), 10.00);

    // 3-axle straight truck: 1.5x -> $15.00
    assert.strictEqual(calculateCommercialToll(baseToll, 3), 15.00);

    // 5-axle Class 8 semi: 2.6x -> $26.00
    assert.strictEqual(calculateCommercialToll(baseToll, 5), 26.00);

    // 7+ axle heavy haul: 4.0x -> $40.00
    assert.strictEqual(calculateCommercialToll(baseToll, 7), 40.00);
});

await test('applies peak congestion rush hour toll surge', () => {
    const baseToll = 20.00;
    const offPeak5Axle = calculateCommercialToll(baseToll, 5, false); // 20 * 2.6 = 52.00
    const peak5Axle = calculateCommercialToll(baseToll, 5, true);      // 52.00 * 1.35 = 70.20

    assert.strictEqual(offPeak5Axle, 52.00);
    assert.strictEqual(peak5Axle, 70.20);
});

await test('computes detailed route operating costs and carbon footprint', () => {
    const cost = calculateRouteOperatingCost({
        distanceMiles: 500,
        estimatedTimeHours: 10,
        tollCostUSD: 50.00,
        fuelPrice: 4.00,
        payloadWeightLbs: 40000,
        driverHourlyRate: 35.00
    });

    assert.strictEqual(cost.distanceMiles, 500);
    assert.strictEqual(cost.effectiveMpg, 6.52);
    // 500 / 6.52 = 76.69 gallons
    assert.strictEqual(cost.fuelGallonsUsed, 76.69);
    // 500 / 6.52 * $4.00 = 306.748... -> 306.75
    assert.strictEqual(cost.fuelCostUSD, 306.75);
    // 10 hrs * $35 = $350.00
    assert.strictEqual(cost.timeCostUSD, 350.00);
    // $306.75 + $350.00 + $50.00 = $706.75
    assert.strictEqual(cost.totalCostUSD, 706.75);
    // Carbon emissions: 76.69 gal * 10.18 kg CO2/gal = 780.7 kg CO2
    assert.strictEqual(cost.carbonEmissionsKg, 780.7);
});

await test('evaluates Pareto trade-off between cheapest, fastest, and greenest routes', () => {
    const candidateRoutes = [
        {
            id: 'TOLLWAY-FAST',
            name: 'Interstate Turnpike (Toll)',
            distanceMiles: 300,
            estimatedTimeHours: 4.5,
            baseTollUSD: 40.00, // Commercial toll = 40 * 2.6 = $104
        },
        {
            id: 'HIGHWAY-FREE',
            name: 'State Highway (Free)',
            distanceMiles: 330,
            estimatedTimeHours: 6.0,
            baseTollUSD: 0,
        },
        {
            id: 'SCENIC-SHORT',
            name: 'Direct Mountain Bypass',
            distanceMiles: 270,
            estimatedTimeHours: 5.5,
            baseTollUSD: 10.00,
            elevationGainFeet: 3500 // Mountain ascent penalty
        }
    ];

    const result = optimizeTollRoutes(candidateRoutes, {
        grossPayoutUSD: 1200,
        axleCount: 5,
        payloadWeightLbs: 35000,
        fuelPrice: 4.10,
        driverHourlyRate: 30.00
    });

    // Verify recommendations
    assert.ok(result.recommendedRoute);
    assert.ok(result.fastestRoute);
    assert.ok(result.greenestRoute);

    // Fast tollway should be fastest (4.5 hrs)
    assert.strictEqual(result.fastestRoute.routeId, 'TOLLWAY-FAST');

    // All candidate routes evaluated and ranked
    assert.strictEqual(result.allCandidateRoutes.length, 3);
    assert.ok(result.optimizationSummary.potentialSavingsUSD >= 0);
});

await test('rejects invalid inputs with proper TypeErrors and RangeErrors', () => {
    assert.throws(() => calculateEffectiveMpg(-500), RangeError);
    assert.throws(() => calculateRouteOperatingCost({ distanceMiles: -10, estimatedTimeHours: 5 }), RangeError);
    assert.throws(() => optimizeTollRoutes([]), TypeError);
    assert.throws(() => optimizeTollRoutes(null), TypeError);
});

console.log('\n🎉 All Commercial Toll & Weight-Fuel Optimization tests passed successfully!\n');
