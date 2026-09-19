import assert from 'assert';
import {
  calculateFootprint,
  getOffsetPackages,
  signCertificatePayload,
  verifyCarbonCertificate,
  purchaseOffset,
  GLEC_EMISSION_FACTORS,
  VEHICLE_AERO_FACTORS,
  OFFSET_PRICE_PER_TON_USD,
  PACKAGES,
} from '../../src/services/carbonOffsetService.js';

console.log('--- Running GLEC Carbon Offset Engine & Crypto Proof Tests ---');

let passedTests = 0;
async function test(name, fn) {
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}:`, err.message);
    throw err;
  }
}

// 1. Constants and GLEC Standards
await test('validates GLEC emission factor hierarchy across powertrain types', () => {
  assert.strictEqual(GLEC_EMISSION_FACTORS.diesel, 62.0);
  assert.ok(GLEC_EMISSION_FACTORS.diesel > GLEC_EMISSION_FACTORS.biodiesel_b20);
  assert.ok(GLEC_EMISSION_FACTORS.biodiesel_b20 > GLEC_EMISSION_FACTORS.cng_lng);
  assert.ok(GLEC_EMISSION_FACTORS.cng_lng > GLEC_EMISSION_FACTORS.electric_grid);
  assert.ok(GLEC_EMISSION_FACTORS.electric_grid > GLEC_EMISSION_FACTORS.green_hydrogen);
  assert.strictEqual(GLEC_EMISSION_FACTORS.green_hydrogen, 4.5);
});

await test('validates SmartWay aerodynamic reduction factor', () => {
  assert.strictEqual(VEHICLE_AERO_FACTORS.smartway_certified, 0.88);
  assert.strictEqual(VEHICLE_AERO_FACTORS.standard, 1.0);
  assert.strictEqual(VEHICLE_AERO_FACTORS.heavy_haul, 1.25);
});

await test('validates verified carbon offset packages', () => {
  const packages = getOffsetPackages();
  assert.strictEqual(packages.length, 4);
  assert.strictEqual(packages[0].id, 'starter');
  assert.strictEqual(packages[3].id, 'enterprise');
  assert.strictEqual(packages[3].tons, 100);
});

// 2. Footprint Calculation Engine
await test('calculates diesel baseline emissions correctly for 1000 km haul with 20 tonnes', () => {
  const result = calculateFootprint({
    distanceKm: 1000,
    weightKg: 20000, // 20 tonnes
    fuelType: 'diesel',
    vehicleClass: 'standard',
  });

  // 1000 km * 20 tonnes = 20,000 tonne-km * 62 g = 1,240,000 g = 1,240 kg = 1.24 tonnes
  assert.strictEqual(result.tonneKm, 20000);
  assert.strictEqual(result.carbonKg, 1240);
  assert.strictEqual(result.carbonTonnes, 1.24);
  assert.strictEqual(result.estimatedOffsetCostUSD, 18.6); // 1.24 * 15.0
});

await test('reflects 64% emission reduction when using electric powertrain vs diesel', () => {
  const diesel = calculateFootprint({
    distanceKm: 800,
    weightKg: 15000,
    fuelType: 'diesel',
  });

  const electric = calculateFootprint({
    distanceKm: 800,
    weightKg: 15000,
    fuelType: 'electric_grid',
  });

  assert.ok(electric.carbonTonnes < diesel.carbonTonnes * 0.4);
});

await test('applies SmartWay aero discount of 12%', () => {
  const standard = calculateFootprint({
    distanceKm: 500,
    weightKg: 10000,
    vehicleClass: 'standard',
  });

  const smartway = calculateFootprint({
    distanceKm: 500,
    weightKg: 10000,
    vehicleClass: 'smartway_certified',
  });

  assert.strictEqual(parseFloat((standard.carbonTonnes * 0.88).toFixed(4)), smartway.carbonTonnes);
});

await test('applies deadhead backhaul repositioning factor', () => {
  const ladenOnly = calculateFootprint({
    distanceKm: 600,
    weightKg: 18000,
    emptyBackhaulPercent: 0,
  });

  const deadheadAllocated = calculateFootprint({
    distanceKm: 600,
    weightKg: 18000,
    emptyBackhaulPercent: 50,
  });

  assert.ok(deadheadAllocated.carbonTonnes > ladenOnly.carbonTonnes);
});

await test('rejects invalid, negative, or non-finite inputs with RangeError', () => {
  assert.throws(() => calculateFootprint({ distanceKm: -100, weightKg: 5000 }), RangeError);
  assert.throws(() => calculateFootprint({ distanceKm: 100, weightKg: -500 }), RangeError);
  assert.throws(() => calculateFootprint({ distanceKm: NaN, weightKg: 5000 }), RangeError);
});

// 3. Cryptographic Certificate Proofs & Anti-Tamper Verification
await test('generates deterministic HMAC-SHA256 certificate signature', () => {
  const payload = {
    certificateId: 'CERT-CO2-001',
    userId: 'user-abc',
    shipmentId: 'shipment-xyz',
    tons: 5,
    issuedAt: '2026-09-19T00:00:00.000Z',
  };

  const sig1 = signCertificatePayload(payload);
  const sig2 = signCertificatePayload(payload);
  assert.strictEqual(sig1, sig2);
  assert.strictEqual(sig1.length, 64);
});

await test('successfully purchases and seals an authenticated offset certificate', async () => {
  const receipt = await purchaseOffset('shipper-777', 'standard', 'shipment-4545');

  assert.strictEqual(receipt.success, true);
  assert.ok(receipt.certificateId.startsWith('CERT-CO2-'));
  assert.strictEqual(receipt.tonsOffset, 5);
  assert.strictEqual(receipt.pricePaidUSD, 70.0);
  assert.ok(receipt.signature && receipt.signature.length === 64);

  // Validate the issued certificate
  const verification = verifyCarbonCertificate(receipt);
  assert.strictEqual(verification.valid, true);
  assert.strictEqual(verification.reason, null);
});

await test('rejects tampered certificate where tons have been altered', async () => {
  const receipt = await purchaseOffset('shipper-888', 'starter', 'shipment-1234');

  // Attacker tampers with the certificate to claim 100 tons instead of 1 ton
  const tamperedReceipt = {
    ...receipt,
    tons: 100,
  };

  const verification = verifyCarbonCertificate(tamperedReceipt);
  assert.strictEqual(verification.valid, false);
  assert.strictEqual(verification.reason, 'Cryptographic signature mismatch');
});

await test('rejects certificate with missing claims or malformed structure', () => {
  assert.strictEqual(verifyCarbonCertificate(null).valid, false);
  assert.strictEqual(verifyCarbonCertificate({}).valid, false);
  assert.strictEqual(verifyCarbonCertificate({ certificateId: 'x' }).valid, false);
});

console.log(`\n🎉 All ${passedTests} GLEC Carbon Offset & Crypto Proof tests passed successfully!\n`);
