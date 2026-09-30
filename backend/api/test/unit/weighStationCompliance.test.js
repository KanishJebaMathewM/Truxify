import assert from 'node:assert';
process.env.NODE_ENV = 'test';
process.env.WIM_SIGNING_SECRET = 'wim-bypass-test-secret';

import {
    calculateBridgeFormulaMaxWeight,
    evaluateBridgeFormulaCompliance,
    checkBypassEligibility,
    syncAndTransmitInternalWeights,
    FHWA_LIMITS
} from '../../src/services/weighStationService.js';
import {
    evaluateBypassEligibility,
    createSignedWimPacket,
    verifySignedWimPacket
} from '../../src/services/wimBypass.js';

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
    } catch (err) {
        console.error(`  ✗ ${name}:`, err.message);
        throw err;
    }
}

console.log('--- Running Federal Bridge Formula & Weigh Station Compliance Tests ---');

await test('calculates Federal Bridge Formula maximum weights correctly', () => {
    // 2 axles spaced 4 feet apart: W = 500 * [ (4*2)/(2-1) + 12*2 + 36 ] = 500 * (8 + 24 + 36) = 500 * 68 = 34,000 lbs
    const w2 = calculateBridgeFormulaMaxWeight(2, 4);
    assert.strictEqual(w2, 34000);

    // 3 axles spaced 8 feet apart: W = 500 * [ (8*3)/(3-1) + 12*3 + 36 ] = 500 * (12 + 36 + 36) = 500 * 84 = 42,000 lbs
    const w3 = calculateBridgeFormulaMaxWeight(3, 8);
    assert.strictEqual(w3, 42000);

    // 5 axles spaced 51 feet apart (standard 18-wheeler semi trailer): capped at 80,000 lbs
    const w5 = calculateBridgeFormulaMaxWeight(5, 51);
    assert.strictEqual(w5, 80000);
});

await test('rejects invalid parameters in calculateBridgeFormulaMaxWeight', () => {
    assert.throws(() => calculateBridgeFormulaMaxWeight(1, 10), RangeError);
    assert.throws(() => calculateBridgeFormulaMaxWeight(3, 0), RangeError);
    assert.throws(() => calculateBridgeFormulaMaxWeight(3, -5), RangeError);
});

await test('approves standard compliant 5-axle 80,000 lbs semi tractor-trailer', () => {
    // Standard legal 5-axle 18-wheeler:
    // Steer: 12,000 lbs (at 0 ft)
    // Drive Tandem: 34,000 lbs (axles 2 & 3 at 14 ft & 18 ft)
    // Trailer Tandem: 34,000 lbs (axles 4 & 5 at 47 ft & 51 ft)
    // Total GVW: 80,000 lbs
    const compliantSemi = {
        declaredGvwLbs: 80000,
        axles: [
            { axleNumber: 1, weightLbs: 12000, distanceFromSteerFeet: 0 },
            { axleNumber: 2, weightLbs: 17000, distanceFromSteerFeet: 14 },
            { axleNumber: 3, weightLbs: 17000, distanceFromSteerFeet: 18 },
            { axleNumber: 4, weightLbs: 17000, distanceFromSteerFeet: 47 },
            { axleNumber: 5, weightLbs: 17000, distanceFromSteerFeet: 51 },
        ]
    };

    const result = evaluateBridgeFormulaCompliance(compliantSemi);
    assert.strictEqual(result.compliant, true);
    assert.strictEqual(result.violationsCount, 0);
    assert.strictEqual(result.verdict, 'COMPLIANT_FOR_BYPASS');
});

await test('detects single axle overload violation (> 20,000 lbs)', () => {
    const overloadedSteer = {
        declaredGvwLbs: 70000,
        axles: [
            { axleNumber: 1, weightLbs: 22000, distanceFromSteerFeet: 0 }, // Over 20k!
            { axleNumber: 2, weightLbs: 16000, distanceFromSteerFeet: 14 },
            { axleNumber: 3, weightLbs: 16000, distanceFromSteerFeet: 18 },
            { axleNumber: 4, weightLbs: 8000, distanceFromSteerFeet: 47 },
            { axleNumber: 5, weightLbs: 8000, distanceFromSteerFeet: 51 },
        ]
    };

    const result = evaluateBridgeFormulaCompliance(overloadedSteer);
    assert.strictEqual(result.compliant, false);
    assert.ok(result.violations.some(v => v.type === 'SINGLE_AXLE_OVERLOAD' && v.axleNumber === 1));
});

await test('detects tandem axle overload violation (> 34,000 lbs)', () => {
    const overloadedTandem = {
        declaredGvwLbs: 78000,
        axles: [
            { axleNumber: 1, weightLbs: 12000, distanceFromSteerFeet: 0 },
            { axleNumber: 2, weightLbs: 18000, distanceFromSteerFeet: 14 },
            { axleNumber: 3, weightLbs: 18000, distanceFromSteerFeet: 18 }, // Drive tandem is 36,000 lbs (> 34k)
            { axleNumber: 4, weightLbs: 15000, distanceFromSteerFeet: 47 },
            { axleNumber: 5, weightLbs: 15000, distanceFromSteerFeet: 51 },
        ]
    };

    const result = evaluateBridgeFormulaCompliance(overloadedTandem);
    assert.strictEqual(result.compliant, false);
    assert.ok(result.violations.some(v => v.type === 'TANDEM_AXLE_OVERLOAD'));
});

await test('detects interstate gross vehicle weight overload (> 80,000 lbs)', () => {
    const heavyLoad = {
        declaredGvwLbs: 84000,
        axles: [
            { axleNumber: 1, weightLbs: 16000, distanceFromSteerFeet: 0 },
            { axleNumber: 2, weightLbs: 17000, distanceFromSteerFeet: 14 },
            { axleNumber: 3, weightLbs: 17000, distanceFromSteerFeet: 18 },
            { axleNumber: 4, weightLbs: 17000, distanceFromSteerFeet: 47 },
            { axleNumber: 5, weightLbs: 17000, distanceFromSteerFeet: 51 },
        ]
    };

    const result = evaluateBridgeFormulaCompliance(heavyLoad);
    assert.strictEqual(result.compliant, false);
    assert.ok(result.violations.some(v => v.type === 'GVW_INTERSTATE_OVERLOAD'));
});

await test('exempts overweight loads if certified overweight permit is present', () => {
    const permittedLoad = {
        declaredGvwLbs: 95000,
        hasOverweightPermit: true,
        axles: [
            { axleNumber: 1, weightLbs: 18000, distanceFromSteerFeet: 0 },
            { axleNumber: 2, weightLbs: 19000, distanceFromSteerFeet: 14 },
            { axleNumber: 3, weightLbs: 19000, distanceFromSteerFeet: 18 },
            { axleNumber: 4, weightLbs: 19500, distanceFromSteerFeet: 47 },
            { axleNumber: 5, weightLbs: 19500, distanceFromSteerFeet: 51 },
        ]
    };

    const result = evaluateBridgeFormulaCompliance(permittedLoad);
    assert.strictEqual(result.compliant, true);
    assert.strictEqual(result.violationsCount, 0);
});

await test('preserves backward compatibility of checkBypassEligibility and syncAndTransmitInternalWeights', async () => {
    const bypass = await checkBypassEligibility('driver-1', 37.77, -122.41);
    assert.strictEqual(bypass.action, 'UNSUPPORTED');
    assert.strictEqual(bypass.supported, false);

    const sync = await syncAndTransmitInternalWeights('driver-1', 'truck-1', []);
    assert.strictEqual(sync.action, 'UNSUPPORTED');
});

await test('wimBypass.evaluateBypassEligibility respects bridge formula axle loads', () => {
    // High safety score, weight under max limit, but tandem is illegal (36,000 lbs)
    const truckData = {
        safetyScore: 95,
        axleWeight: 76000,
        maxWeightLimit: 80000,
        axles: [
            { axleNumber: 1, weightLbs: 12000, distanceFromSteerFeet: 0 },
            { axleNumber: 2, weightLbs: 18000, distanceFromSteerFeet: 14 },
            { axleNumber: 3, weightLbs: 18000, distanceFromSteerFeet: 18 }, // Tandem overload!
            { axleNumber: 4, weightLbs: 14000, distanceFromSteerFeet: 47 },
            { axleNumber: 5, weightLbs: 14000, distanceFromSteerFeet: 51 },
        ]
    };

    const eligible = evaluateBypassEligibility(truckData);
    assert.strictEqual(eligible, false);
});

await test('creates and cryptographically verifies signed WIM packets', () => {
    const payload = {
        truckId: 'TRUCK-999',
        safetyScore: 95,
        bolId: 'BOL-777-XYZ',
        axleWeight: 78000
    };

    const signedPacket = createSignedWimPacket(payload);
    assert.ok(signedPacket.packet.timestamp > 0);
    assert.strictEqual(signedPacket.signature.length, 64);

    const verification = verifySignedWimPacket(signedPacket);
    assert.strictEqual(verification.valid, true);
    assert.strictEqual(verification.packet.truckId, 'TRUCK-999');
});

await test('rejects tampered or expired WIM packet', () => {
    const payload = { truckId: 'TRUCK-444', safetyScore: 90, bolId: 'BOL-1', axleWeight: 50000 };
    const signedPacket = createSignedWimPacket(payload);

    // Tamper with payload
    const tampered = {
        packet: { ...signedPacket.packet, safetyScore: 100 },
        signature: signedPacket.signature
    };
    const tamperedVerif = verifySignedWimPacket(tampered);
    assert.strictEqual(tamperedVerif.valid, false);
    assert.strictEqual(tamperedVerif.reason, 'Cryptographic signature mismatch');

    // Expired packet (older than 5 minutes)
    const expired = {
        packet: { ...signedPacket.packet, timestamp: Date.now() - 400000 },
        signature: signedPacket.signature
    };
    const expiredVerif = verifySignedWimPacket(expired);
    assert.strictEqual(expiredVerif.valid, false);
    assert.strictEqual(expiredVerif.reason, 'Packet expired (replay attack defense)');
});

console.log('\n🎉 All Federal Bridge Formula & Weigh Station Compliance tests passed successfully!\n');
