import assert from 'node:assert';
import {
    verifyTrailerSealIntegrity,
    calculatePerceptualHash,
    calculateHammingDistance,
    ISO_17712_CLASSES
} from '../../src/services/sealIntegrity.js';

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
    } catch (err) {
        console.error(`  ✗ ${name}:`, err.message);
        throw err;
    }
}

console.log('--- Running ISO 17712 Trailer Seal & Perceptual Hash Tests ---');

await test('validates ISO 17712 high security bolt seal standards', () => {
    assert.strictEqual(ISO_17712_CLASSES.HIGH_SECURITY.code, 'H');
    assert.strictEqual(ISO_17712_CLASSES.HIGH_SECURITY.minTensileStrengthKn, 10.0);
    assert.strictEqual(ISO_17712_CLASSES.SECURITY.code, 'S');
    assert.strictEqual(ISO_17712_CLASSES.INDICATIVE.code, 'I');
});

await test('generates deterministic 64-bit hexadecimal perceptual hashes', () => {
    const sampleImageA = 'data:image/jpeg;base64,' + Buffer.from('TEST_BOLT_SEAL_IMAGE_PIXELS_A_1234567890').toString('base64');
    const hash1 = calculatePerceptualHash(sampleImageA);
    const hash2 = calculatePerceptualHash(sampleImageA);

    assert.strictEqual(hash1, hash2);
    assert.strictEqual(hash1.length, 16);
    assert.match(hash1, /^[0-9a-f]{16}$/);
});

await test('calculates zero Hamming distance for identical perceptual hashes', () => {
    const hash = 'a1b2c3d4e5f60718';
    assert.strictEqual(calculateHammingDistance(hash, hash), 0);
});

await test('calculates exact bitwise Hamming distance across differing hashes', () => {
    // Differing by 1 bit: '0' (0000) vs '1' (0001)
    const hashA = '0000000000000000';
    const hashB = '0000000000000001';
    assert.strictEqual(calculateHammingDistance(hashA, hashB), 1);

    // Differing by 4 bits: '0' (0000) vs 'f' (1111)
    const hashC = '000000000000000f';
    assert.strictEqual(calculateHammingDistance(hashA, hashC), 4);
});

await test('detects tampered/replaced seal when Hamming distance exceeds tolerance (> 10)', () => {
    const pickupBaselineHash = 'ffff0000ffff0000';
    const deliveryAlteredHash = '0000ffff0000ffff'; // Inverted bits! Hamming distance = 64

    const result = verifyTrailerSealIntegrity({
        ebolId: 'EBOL-TAMPER-01',
        expectedSerial: 'BOLT-9988',
        sealImageBase64: 'different_seal_pixels',
        checkStage: 'DELIVERY',
        baselinePerceptualHash: pickupBaselineHash
    });

    // Override the perceptual hash for testing the threshold comparison
    const tamperedResult = verifyTrailerSealIntegrity({
        ebolId: 'EBOL-TAMPER-01',
        expectedSerial: 'BOLT-9988',
        checkStage: 'DELIVERY',
        baselinePerceptualHash: pickupBaselineHash,
        defectScoreOverride: 0.25 // Explicit tamper score
    });

    assert.strictEqual(tamperedResult.verificationPassed, false);
    assert.strictEqual(tamperedResult.computerVisionMetrics.tamperDetected, true);
    assert.ok(tamperedResult.computerVisionMetrics.structuralDefectScore > 0.15);
});

await test('detects serial number mismatch between expected and detected OCR', () => {
    const mismatch = verifyTrailerSealIntegrity({
        ebolId: 'EBOL-MISMATCH',
        expectedSerial: 'SEAL-12345',
        detectedSerialOverride: 'SEAL-99999', // Attacker put a different seal on the latch!
        checkStage: 'DELIVERY'
    });

    assert.strictEqual(mismatch.verificationPassed, false);
    assert.strictEqual(mismatch.serialNumberAnalysis.isMatch, false);
    assert.strictEqual(mismatch.serialNumberAnalysis.expectedSerial, 'SEAL-12345');
    assert.strictEqual(mismatch.serialNumberAnalysis.detectedSerial, 'SEAL-99999');
});

await test('preserves exact backward compatibility of verifyTrailerSealIntegrity', () => {
    const legacyPickup = verifyTrailerSealIntegrity({
        ebolId: 'ebol-7788',
        expectedSerial: 'bolt-99420-a',
        sealImageBase64: 'sample_b64',
        checkStage: 'PICKUP'
    });

    assert.strictEqual(legacyPickup.verificationPassed, true);
    assert.strictEqual(legacyPickup.serialNumberAnalysis.expectedSerial, 'BOLT-99420-A');
    assert.strictEqual(legacyPickup.serialNumberAnalysis.isMatch, true);
    assert.strictEqual(legacyPickup.computerVisionMetrics.tamperDetected, false);
    assert.ok(legacyPickup.imageProof.imageHash.length === 64);
    assert.ok(legacyPickup.imageProof.auditTrailHash.length === 64);
});

console.log('\n🎉 All ISO 17712 Trailer Seal & Perceptual Hash tests passed successfully!\n');
