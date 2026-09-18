import assert from 'assert';
import { TraceabilityService, DEFAULT_COLD_CHAIN_BOUNDS } from './trace.service.js';

async function runTests() {
    console.log('--- Running TraceabilityService Cryptographic Verification Tests ---');

    const service = new TraceabilityService();
    assert(service, 'TraceabilityService instance should be created');

    // 1. Test computeEventHash
    console.log('[Test 1] Deterministic Keccak-256 Event Hashing');
    const genesisProductHash = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const timestamp1 = '2026-09-17T10:00:00.000Z';

    const event1 = {
        productId: 'PROD-VACCINE-001',
        eventType: 'MANUFACTURED',
        location: 'Facility A, Geneva',
        description: 'Batch synthesized and packaged into cold storage',
        prevHash: genesisProductHash,
        timestamp: timestamp1
    };

    const hash1 = service.computeEventHash(event1);
    assert(typeof hash1 === 'string' && hash1.startsWith('0x') && hash1.length === 66, 'Hash must be 32-byte hex string');
    
    // Determinism test
    const hash1Duplicate = service.computeEventHash(event1);
    assert.strictEqual(hash1, hash1Duplicate, 'Hashes must be deterministic for identical inputs');

    // Dependency on prevHash
    const alteredPrevHash = service.computeEventHash({
        ...event1,
        prevHash: '0x2222222222222222222222222222222222222222222222222222222222222222'
    });
    assert.notStrictEqual(hash1, alteredPrevHash, 'Hash must change when predecessor hash changes');
    console.log('✓ Deterministic hashing validated');

    // 2. Test Sequential Hash Chaining
    console.log('[Test 2] Sequential Event Hash Chain Verification');
    const timestamp2 = '2026-09-17T11:30:00.000Z';
    const event2 = {
        productId: 'PROD-VACCINE-001',
        eventType: 'LOADED_ON_REEFER',
        location: 'Dock 4, Geneva',
        description: 'Loaded into temperature-controlled reefer trailer TRK-550',
        prevHash: hash1,
        timestamp: timestamp2
    };
    const hash2 = service.computeEventHash(event2);

    const timestamp3 = '2026-09-17T14:15:00.000Z';
    const event3 = {
        productId: 'PROD-VACCINE-001',
        eventType: 'CROSS_DOCK_TRANSIT',
        location: 'Distribution Hub, Lyon',
        description: 'Intermediate customs clearance and seal integrity check',
        prevHash: hash2,
        timestamp: timestamp3
    };
    const hash3 = service.computeEventHash(event3);

    const timestamp4 = '2026-09-17T18:00:00.000Z';
    const event4 = {
        productId: 'PROD-VACCINE-001',
        eventType: 'DELIVERED_TO_HOSPITAL',
        location: 'Hospital Pharmacy, Paris',
        description: 'Received by hospital cold storage pharmacist',
        prevHash: hash3,
        timestamp: timestamp4
    };
    const hash4 = service.computeEventHash(event4);

    const validChain = [
        { ...event1, eventHash: hash1 },
        { ...event2, eventHash: hash2 },
        { ...event3, eventHash: hash3 },
        { ...event4, eventHash: hash4 }
    ];

    const chainVerification = service.verifyEventChain(validChain, genesisProductHash);
    assert.strictEqual(chainVerification.isValid, true, 'Valid audit chain should verify with true');
    assert.strictEqual(chainVerification.chainLength, 4, 'Chain length should be 4');
    assert.strictEqual(chainVerification.headHash, hash4, 'Head hash should equal event4 hash');
    console.log('✓ Sequential 4-event hash chain verified successfully');

    // 3. Test Tamper Detection: Modified description in Event 2
    console.log('[Test 3] Tamper Detection - Modified Payload');
    const tamperedPayloadChain = [
        { ...event1, eventHash: hash1 },
        { ...event2, description: 'Tampered description without updating hash', eventHash: hash2 },
        { ...event3, eventHash: hash3 },
        { ...event4, eventHash: hash4 }
    ];

    const tamperResult1 = service.verifyEventChain(tamperedPayloadChain, genesisProductHash);
    assert.strictEqual(tamperResult1.isValid, false, 'Tampered chain must be detected');
    assert.strictEqual(tamperResult1.brokenIndex, 1, 'Should pinpoint tamper at index 1');
    assert(tamperResult1.reason.includes('Tamper detected at event 1'), 'Reason should identify hash mismatch');
    console.log('✓ Payload tampering detected at exact index');

    // 4. Test Tamper Detection: Event Reordering
    console.log('[Test 4] Tamper Detection - Event Reordering / Swapping');
    const reorderedChain = [
        { ...event1, eventHash: hash1 },
        { ...event3, eventHash: hash3 }, // Swapped event 3 before event 2
        { ...event2, eventHash: hash2 },
        { ...event4, eventHash: hash4 }
    ];

    const tamperResult2 = service.verifyEventChain(reorderedChain, genesisProductHash);
    assert.strictEqual(tamperResult2.isValid, false, 'Reordered events must be detected');
    assert.strictEqual(tamperResult2.brokenIndex, 1, 'Chain break must occur at index 1');
    assert(tamperResult2.reason.includes('Chain broken at event 1'), 'Reason should identify broken link');
    console.log('✓ Event reordering detected');

    // 5. Test Tamper Detection: Dropped Event
    console.log('[Test 5] Tamper Detection - Omitted Event');
    const droppedEventChain = [
        { ...event1, eventHash: hash1 },
        { ...event3, eventHash: hash3 }, // Omitted event 2
        { ...event4, eventHash: hash4 }
    ];

    const tamperResult3 = service.verifyEventChain(droppedEventChain, genesisProductHash);
    assert.strictEqual(tamperResult3.isValid, false, 'Omitted event must be detected');
    assert.strictEqual(tamperResult3.brokenIndex, 1);
    console.log('✓ Omitted/dropped event detected');

    // 6. Test Sensor Telemetry Checkpoint Recording
    console.log('[Test 6] Sensor Telemetry Checkpoint Recording');
    const checkpoint1 = service.recordSensorTelemetryCheckpoint(
        'PROD-VACCINE-001',
        {
            temperatureC: 4.5,
            humidityPercent: 48,
            vibrationG: 0.2,
            location: 'Route A6, France'
        },
        hash4
    );

    assert(checkpoint1.checkpointHash, 'Checkpoint hash must be generated');
    assert.strictEqual(checkpoint1.temperatureC, 4.5);
    assert.strictEqual(checkpoint1.prevHash, hash4);

    // Validate sensor input rejection on impossible physical bounds
    assert.throws(
        () => service.recordSensorTelemetryCheckpoint('PROD-1', { temperatureC: -75 }, hash4),
        /Invalid temperatureC/
    );
    assert.throws(
        () => service.recordSensorTelemetryCheckpoint('PROD-1', { humidityPercent: 120 }, hash4),
        /Invalid humidityPercent/
    );
    console.log('✓ Sensor telemetry checkpoints and boundary guards validated');

    // 7. Test Cold-Chain Excursion / Breach Detection
    console.log('[Test 7] Cold-Chain Breach Detection');
    const normalCheckpoints = [
        { timestamp: '10:00', temperatureC: 3.5, location: 'Dock' },
        { timestamp: '11:00', temperatureC: 4.2, location: 'Highway' },
        { timestamp: '12:00', temperatureC: 5.0, location: 'Tunnel' },
        { timestamp: '13:00', temperatureC: 4.8, location: 'Rest Stop' }
    ];

    const compliantResult = service.detectColdChainBreach(normalCheckpoints, DEFAULT_COLD_CHAIN_BOUNDS);
    assert.strictEqual(compliantResult.hasBreach, false);
    assert.strictEqual(compliantResult.totalExcursions, 0);

    const breachedCheckpoints = [
        { timestamp: '10:00', temperatureC: 4.0, location: 'Dock' },
        { timestamp: '11:00', temperatureC: 9.8, location: 'Highway' }, // OVER_TEMP (bound is 8.0) -> +1.8
        { timestamp: '12:00', temperatureC: 11.2, location: 'Rest Stop' }, // OVER_TEMP -> +3.2
        { timestamp: '13:00', temperatureC: 1.2, location: 'Transfer' }, // UNDER_TEMP (bound is 2.0) -> -0.8
        { timestamp: '14:00', temperatureC: 4.5, location: 'Hospital' } // Compliant
    ];

    const breachResult = service.detectColdChainBreach(breachedCheckpoints, DEFAULT_COLD_CHAIN_BOUNDS);
    assert.strictEqual(breachResult.hasBreach, true);
    assert.strictEqual(breachResult.totalExcursions, 3);
    assert.strictEqual(breachResult.maxDeviationC, 3.2);
    assert.strictEqual(breachResult.breachCheckpoints.length, 3);
    assert.strictEqual(breachResult.breachCheckpoints[0].type, 'OVER_TEMP');
    assert.strictEqual(breachResult.breachCheckpoints[2].type, 'UNDER_TEMP');
    console.log('✓ Cold-chain excursion and deviation analysis validated');

    // 8. Test Shipment Ownership & Access Control (CWE-639)
    console.log('[Test 8] Access Control Verification (CWE-639 IDOR Protection)');
    const hasAccess = await service.verifyShipmentOwnership('SHP-99', 'USR-AUTHORIZED-OWNER');
    assert(typeof hasAccess === 'boolean', 'Ownership verification returns boolean');
    console.log('✓ Ownership access check executed safely');

    // 9. Test Product Creation and Hash Generation
    console.log('[Test 9] Product Creation Hash Generation');
    const productResult = await service.createProduct({
        name: 'mRNA Vaccine V-90',
        description: 'Lyophilized sterile suspension',
        category: 'pharmaceuticals'
    });

    assert(productResult.success, 'Product creation should succeed');
    assert(productResult.productId, 'Product ID should be generated');
    assert(productResult.productHash, 'Product hash should be generated');
    assert(productResult.txHash, 'Transaction hash should be generated');
    console.log('✓ Product creation and root hash generation validated');

    console.log('\n======================================================');
    console.log('🎉 ALL 9 TRACEABILITY CRYPTOGRAPHIC TESTS PASSED!');
    console.log('======================================================\n');
    process.exit(0);
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
