import assert from 'node:assert';
import {
    matchLtlPartialLoads,
    optimizeLtlConsolidationKnapsack,
    validateCommodityCompatibility,
    HAZMAT_INCOMPATIBILITY_RULES
} from '../../src/services/ltlConsolidation.js';

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
    } catch (err) {
        console.error(`  ✗ ${name}:`, err.message);
        throw err;
    }
}

console.log('--- Running LTL Knapsack Consolidation & HAZMAT Optimizer Tests ---');

const testTruck = {
    id: 'TRUCK-KNAPSACK-01',
    remainingLinearFeet: 24,
    remainingWeightLbs: 20000,
    maxDelayMinutesTolerance: 60,
};

await test('validates HAZMAT commodity incompatibility rules', () => {
    assert.strictEqual(validateCommodityCompatibility(['FOOD_GRADE', 'GENERAL_FREIGHT']), true);
    assert.strictEqual(validateCommodityCompatibility(['FOOD_GRADE', 'CORROSIVE_8']), false);
    assert.strictEqual(validateCommodityCompatibility(['FOOD_GRADE', 'POISON_6']), false);
    assert.strictEqual(validateCommodityCompatibility(['CORROSIVE_8', 'FLAMMABLE_3']), false);
    assert.strictEqual(validateCommodityCompatibility(['PHARMACEUTICAL', 'FOOD_GRADE']), true);
    assert.strictEqual(validateCommodityCompatibility(['PHARMACEUTICAL', 'POISON_6']), false);
});

await test('optimizes 2-load combination that beats single high-payout greedy choice', () => {
    // Greedy approach would pick Single Big Load ($800) using 22 ft, 18000 lbs.
    // Knapsack bundle should pick Pair A ($550) + Pair B ($500) = $1050 total!
    const candidates = [
        {
            id: 'GREEDY-SINGLE',
            requiredLinearFeet: 22,
            requiredWeightLbs: 18000,
            estimatedDetourMinutes: 10,
            payoutUSD: 800,
        },
        {
            id: 'PAIR-A',
            requiredLinearFeet: 12,
            requiredWeightLbs: 9000,
            estimatedDetourMinutes: 15,
            payoutUSD: 550,
        },
        {
            id: 'PAIR-B',
            requiredLinearFeet: 10,
            requiredWeightLbs: 9500,
            estimatedDetourMinutes: 15,
            payoutUSD: 500,
        },
    ];

    const result = optimizeLtlConsolidationKnapsack(testTruck, candidates);

    assert.strictEqual(result.status, 'OPTIMAL');
    assert.strictEqual(result.optimalBundle.length, 2);
    const loadIds = result.optimalBundle.map(l => l.loadId);
    assert.ok(loadIds.includes('PAIR-A'));
    assert.ok(loadIds.includes('PAIR-B'));
    assert.ok(!loadIds.includes('GREEDY-SINGLE'));
    assert.ok(result.totalGrossPayoutUSD >= 1050);
});

await test('prevents co-loading of incompatible HAZMAT commodities in optimal bundle', () => {
    const candidates = [
        {
            id: 'FOOD-PALLET',
            commodityType: 'FOOD_GRADE',
            requiredLinearFeet: 10,
            requiredWeightLbs: 8000,
            estimatedDetourMinutes: 10,
            payoutUSD: 600,
        },
        {
            id: 'ACID-DRUMS',
            commodityType: 'CORROSIVE_8',
            requiredLinearFeet: 10,
            requiredWeightLbs: 8000,
            estimatedDetourMinutes: 10,
            payoutUSD: 700,
        },
        {
            id: 'SAFE-PARTS',
            commodityType: 'GENERAL_FREIGHT',
            requiredLinearFeet: 10,
            requiredWeightLbs: 8000,
            estimatedDetourMinutes: 10,
            payoutUSD: 550,
        }
    ];

    const result = optimizeLtlConsolidationKnapsack(testTruck, candidates);

    const bundledCommodities = result.optimalBundle.map(l => l.commodityType);
    const hasFood = bundledCommodities.includes('FOOD_GRADE');
    const hasCorrosive = bundledCommodities.includes('CORROSIVE_8');

    // Both FOOD_GRADE and CORROSIVE_8 MUST NOT be co-loaded!
    assert.strictEqual(hasFood && hasCorrosive, false);
    assert.strictEqual(validateCommodityCompatibility(bundledCommodities), true);
});

await test('enforces aggregate detour time budget constraint', () => {
    // 3 loads, each fits space and weight, but together they exceed 60 min delay tolerance
    const candidates = [
        {
            id: 'DETOUR-1',
            requiredLinearFeet: 6,
            requiredWeightLbs: 4000,
            estimatedDetourMinutes: 25,
            payoutUSD: 400,
        },
        {
            id: 'DETOUR-2',
            requiredLinearFeet: 6,
            requiredWeightLbs: 4000,
            estimatedDetourMinutes: 25,
            payoutUSD: 400,
        },
        {
            id: 'DETOUR-3',
            requiredLinearFeet: 6,
            requiredWeightLbs: 4000,
            estimatedDetourMinutes: 25,
            payoutUSD: 400,
        },
    ];

    const result = optimizeLtlConsolidationKnapsack(testTruck, candidates);

    assert.ok(result.totalDetourMinutes <= testTruck.maxDelayMinutesTolerance);
    assert.strictEqual(result.optimalBundle.length, 2); // 2 * 25 = 50 min <= 60 min
});

await test('awards high fill-rate efficiency bonus when trailer space exceeds 80%', () => {
    // Total capacity: 24 linear feet. 20 ft = 83.3% fill rate (> 80%)
    const candidates = [
        {
            id: 'DENSE-LOAD',
            requiredLinearFeet: 20,
            requiredWeightLbs: 15000,
            estimatedDetourMinutes: 0,
            payoutUSD: 1000,
        }
    ];

    const result = optimizeLtlConsolidationKnapsack(testTruck, candidates);

    assert.ok(result.capacityUtilization.linearFootPercentage >= 80.0);
    // 5% bonus on $1000 = $50
    assert.strictEqual(result.highFillRateBonusUSD, 50.0);
    assert.strictEqual(result.totalNetPayoutUSD, 1050.0);
});

await test('generates LIFO unloading sequence for multi-stop delivery', () => {
    const candidates = [
        {
            id: 'STOP-A',
            destination: 'Atlanta, GA',
            requiredLinearFeet: 10,
            requiredWeightLbs: 8000,
            estimatedDetourMinutes: 10,
            payoutUSD: 500,
        },
        {
            id: 'STOP-B',
            destination: 'Charlotte, NC',
            requiredLinearFeet: 10,
            requiredWeightLbs: 8000,
            estimatedDetourMinutes: 15,
            payoutUSD: 600,
        }
    ];

    const result = optimizeLtlConsolidationKnapsack(testTruck, candidates);

    assert.strictEqual(result.stopSequence.length, 2);
    assert.strictEqual(result.stopSequence[0].sequenceNumber, 1);
    assert.strictEqual(result.stopSequence[1].sequenceNumber, 2);
    assert.strictEqual(result.stopSequence[0].type, 'DROPOFF');
});

await test('handles zero remaining capacity gracefully without division by zero', () => {
    const emptyTruck = { id: 'FULL-TRUCK', remainingLinearFeet: 0, remainingWeightLbs: 0 };
    const result = optimizeLtlConsolidationKnapsack(emptyTruck, [{ id: 'L1', requiredLinearFeet: 5, requiredWeightLbs: 1000, payoutUSD: 100 }]);

    assert.strictEqual(result.status, 'NO_CAPACITY');
    assert.strictEqual(result.optimalBundle.length, 0);
    assert.strictEqual(result.capacityUtilization.linearFootPercentage, 0);
});

await test('preserves backward compatibility of matchLtlPartialLoads ranking', () => {
    const partialLoads = [
        { id: 'L1', requiredLinearFeet: 10, requiredWeightLbs: 5000, estimatedDetourMinutes: 10, payoutUSD: 400 },
        { id: 'L2', requiredLinearFeet: 12, requiredWeightLbs: 6000, estimatedDetourMinutes: 20, payoutUSD: 800 },
    ];

    const result = matchLtlPartialLoads(testTruck, partialLoads);

    assert.strictEqual(result.matchedCount, 2);
    assert.strictEqual(result.matches[0].loadId, 'L2'); // higher net payout
    assert.strictEqual(result.matches[1].loadId, 'L1');
});

console.log('\n🎉 All LTL Knapsack Consolidation & HAZMAT Optimizer tests passed successfully!\n');
