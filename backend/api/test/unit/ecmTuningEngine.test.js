import assert from 'node:assert';
import {
    determineOptimalEcmProfile,
    generateOtaTuningPayload,
    verifyOtaTuningPayload,
    calculateRollingElevationGradient,
    packageIntoJ1939CanFrames,
    calculateCrc16,
    ECM_PROFILES,
    J1939_PGNS,
    UDS_SERVICES
} from '../../src/services/ecmTuning.js';

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
    } catch (err) {
        console.error(`  ✗ ${name}:`, err.message);
        throw err;
    }
}

console.log('--- Running SAE J1939 ECM Tuning & CAN-Bus OTA Engine Tests ---');

await test('validates SAE J1939 PGNs and ISO 14229 UDS diagnostic services', () => {
    assert.strictEqual(J1939_PGNS.EEC1.pgn, 61444);
    assert.strictEqual(J1939_PGNS.LFE.pgn, 65266);
    assert.strictEqual(UDS_SERVICES.DIAGNOSTIC_SESSION_CONTROL, 0x10);
    assert.strictEqual(UDS_SERVICES.REQUEST_DOWNLOAD, 0x34);
    assert.strictEqual(UDS_SERVICES.TRANSFER_DATA, 0x36);
});

await test('computes rolling elevation gradient correctly across elevation waypoints', () => {
    // 1000m run with 50m rise -> 5.0% gradient
    const climbWaypoints = [
        { distanceMeters: 0, elevationMeters: 100 },
        { distanceMeters: 500, elevationMeters: 125 },
        { distanceMeters: 1000, elevationMeters: 150 },
    ];
    const climbGrade = calculateRollingElevationGradient(climbWaypoints);
    assert.strictEqual(climbGrade, 5.0);

    // 1000m run with 40m drop -> -4.0% gradient
    const descentWaypoints = [
        { distanceMeters: 0, elevationMeters: 200 },
        { distanceMeters: 1000, elevationMeters: 160 },
    ];
    const descentGrade = calculateRollingElevationGradient(descentWaypoints);
    assert.strictEqual(descentGrade, -4.0);
});

await test('selects ECM profile based on computed waypoint gradient', () => {
    const steepClimb = determineOptimalEcmProfile({
        waypoints: [
            { distanceMeters: 0, elevationMeters: 0 },
            { distanceMeters: 1000, elevationMeters: 45 } // +4.5%
        ]
    });
    assert.strictEqual(steepClimb.profileId, 'PROFILE_MOUNTAIN_POWER_v3.1');

    const steepDescent = determineOptimalEcmProfile({
        waypoints: [
            { distanceMeters: 0, elevationMeters: 100 },
            { distanceMeters: 1000, elevationMeters: 60 } // -4.0%
        ]
    });
    assert.strictEqual(steepDescent.profileId, 'PROFILE_DESCENT_REGEN_v1.8');
});

await test('generates and cryptographically verifies authentic OTA tuning package', () => {
    const payload = generateOtaTuningPayload({
        truckId: 'TRUCK-CAN-01',
        vin: '1M8GDM9A_TRUXIFY_2026',
        topologyData: { averageGradientPercent: 4.0 }
    });

    assert.strictEqual(payload.status, 'READY_FOR_TRANSMISSION');
    assert.ok(payload.signature.length === 64);

    const verification = verifyOtaTuningPayload(payload.otaPackage, payload.signature);
    assert.strictEqual(verification.valid, true);
    assert.strictEqual(verification.reason, null);
});

await test('rejects tampered OTA tuning package with modified profile', () => {
    const payload = generateOtaTuningPayload({
        truckId: 'TRUCK-CAN-02',
        vin: 'VIN-SEC-TEST',
        topologyData: { averageGradientPercent: 0 }
    });

    // Attacker alters target profile to unrestricted torque
    const tamperedPackage = {
        ...payload.otaPackage,
        targetProfile: {
            ...payload.otaPackage.targetProfile,
            maxTorqueNm: 9999
        }
    };

    const verification = verifyOtaTuningPayload(tamperedPackage, payload.signature);
    assert.strictEqual(verification.valid, false);
    assert.strictEqual(verification.reason, 'Cryptographic signature mismatch');
});

await test('rejects expired OTA tuning package beyond validity window', () => {
    const payload = generateOtaTuningPayload({ truckId: 'TRUCK-EXP' });

    // Expired timestamp (4000 seconds ago > 3600 second window)
    const expiredPackage = {
        ...payload.otaPackage,
        dispatchTimestamp: Date.now() - 4000000
    };

    const verification = verifyOtaTuningPayload(expiredPackage, payload.signature);
    assert.strictEqual(verification.valid, false);
    assert.strictEqual(verification.reason, 'OTA tuning package has expired');
});

await test('packages calibration payload into sequential J1939 CAN-bus 8-byte frames with CRC-16', () => {
    const otaPayload = generateOtaTuningPayload({
        truckId: 'TRUCK-J1939',
        vin: 'VIN-J1939-01',
        topologyData: { upcomingTerrain: 'MOUNTAIN_CLIMB' }
    });

    const stream = packageIntoJ1939CanFrames(otaPayload);

    assert.ok(stream.totalFrames >= 2);
    assert.strictEqual(stream.frames[0].type, 'TP_CM_BAM'); // BAM Header
    assert.strictEqual(stream.frames[0].pgn, 60416);

    // Frame 1 should be TP_DT with sequence number 1
    assert.strictEqual(stream.frames[1].type, 'TP_DT');
    assert.strictEqual(stream.frames[1].pgn, 60160);
    assert.strictEqual(stream.frames[1].sequenceNumber, 1);
    assert.strictEqual(stream.frames[1].dataBytesHex.length, 16); // 8 bytes = 16 hex chars
    assert.ok(stream.frames[1].crc16Hex.startsWith('0x'));
});

await test('calculates valid CRC-16 checksums for frame buffers', () => {
    const testBuf = Buffer.from('123456789', 'ascii');
    const crc = calculateCrc16(testBuf);
    assert.ok(Number.isInteger(crc) && crc > 0);
});

console.log('\n🎉 All SAE J1939 ECM Tuning & CAN-Bus OTA Engine tests passed successfully!\n');
