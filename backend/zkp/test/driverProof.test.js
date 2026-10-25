import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  VEHICLE_CATEGORIES,
  toEpochDays,
  computeDriverCommitment,
  prepareCircuitInputs,
  generateDriverQualificationProof,
} from '../driverProofGenerator.js';
import { DriverProofVerifier } from '../driverProofVerifier.js';

const DRIVER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const SALT = '0x' + '11'.repeat(32);

const validParams = () => ({
  driverAddress: DRIVER,
  birthDate: '1990-05-15',
  licenseExpiryDate: '2030-01-01',
  vehicleCategory: 'HCV',
  backgroundCheckPassed: true,
  tripDate: '2026-10-15',
  requiredCategory: 'LCV',
  driverSecretSalt: SALT,
});

describe('toEpochDays', () => {
  test('converts dates and rejects garbage', () => {
    assert.equal(toEpochDays('1970-01-02'), 1);
    assert.equal(toEpochDays(new Date('1970-01-11')), 10);
    assert.throws(() => toEpochDays('not-a-date'), /Invalid date/);
  });
});

describe('computeDriverCommitment', () => {
  test('is deterministic and binding on all three inputs', () => {
    const base = computeDriverCommitment(DRIVER, SALT, VEHICLE_CATEGORIES.HCV);
    assert.equal(base, computeDriverCommitment(DRIVER, SALT, VEHICLE_CATEGORIES.HCV));
    assert.notEqual(base, computeDriverCommitment(DRIVER, SALT, VEHICLE_CATEGORIES.LCV));
    assert.notEqual(base, computeDriverCommitment(DRIVER, '0x' + '22'.repeat(32), VEHICLE_CATEGORIES.HCV));
    assert.notEqual(base, computeDriverCommitment('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', SALT, VEHICLE_CATEGORIES.HCV));
  });

  test('rejects a malformed address', () => {
    assert.throws(() => computeDriverCommitment('0xnotanaddress', SALT, 1));
  });

  test('accepts a numeric salt (normalized to bytes32)', () => {
    const a = computeDriverCommitment(DRIVER, 17n, 2);
    const b = computeDriverCommitment(DRIVER, '0x' + 17n.toString(16).padStart(64, '0'), 2);
    assert.equal(a, b);
  });
});

describe('prepareCircuitInputs', () => {
  test('produces the full witness with public/private signal split', () => {
    const { circuitInputs, metadata } = prepareCircuitInputs(validParams());
    assert.equal(circuitInputs.driverAddress, BigInt(DRIVER).toString());
    assert.equal(circuitInputs.driverVehicleCategory, String(VEHICLE_CATEGORIES.HCV));
    assert.equal(circuitInputs.requiredVehicleCategory, String(VEHICLE_CATEGORIES.LCV));
    assert.equal(circuitInputs.backgroundCheckStatus, '1');
    assert.equal(BigInt(circuitInputs.expectedCommitment).toString(16).length > 0, true);
    assert.equal(metadata.categoryCode, VEHICLE_CATEGORIES.HCV);
  });

  test('requires a valid driver address', () => {
    assert.throws(() => prepareCircuitInputs({ ...validParams(), driverAddress: 'bad' }), /valid driver/i);
    assert.throws(() => prepareCircuitInputs({ ...validParams(), driverAddress: null }), /valid driver/i);
  });

  test('numeric and string category names agree; unknown names default to LCV', () => {
    const byName = prepareCircuitInputs({ ...validParams(), vehicleCategory: 'TRAILER' });
    const byCode = prepareCircuitInputs({ ...validParams(), vehicleCategory: 3 });
    assert.equal(byName.circuitInputs.driverVehicleCategory, byCode.circuitInputs.driverVehicleCategory);
    const unknown = prepareCircuitInputs({ ...validParams(), vehicleCategory: 'SPACESHIP' });
    assert.equal(unknown.circuitInputs.driverVehicleCategory, String(VEHICLE_CATEGORIES.LCV));
  });

  test('backgroundCheckPassed=false maps to 0', () => {
    const { circuitInputs } = prepareCircuitInputs({ ...validParams(), backgroundCheckPassed: false });
    assert.equal(circuitInputs.backgroundCheckStatus, '0');
  });
});

describe('generateDriverQualificationProof + verifyProofOffChain round-trip', () => {
  test('a generated proof verifies off-chain against the same driver/category', async () => {
    const payload = await generateDriverQualificationProof(validParams());
    assert.equal(payload.success, true);
    const v = new DriverProofVerifier({});
    const tripDays = toEpochDays('2026-10-01'); // proof trip date is AFTER this
    const res = v.verifyProofOffChain(payload, DRIVER, VEHICLE_CATEGORIES.LCV, tripDays);
    assert.equal(res.isValid, true, res.reason);
    // the circuit's public input[2] is the REQUIRED category (the driver's
    // actual class is private) — the verifier reports that public signal
    assert.equal(res.details.vehicleCategory, VEHICLE_CATEGORIES.LCV);
  });

  test('rejects a proof bound to a different driver', async () => {
    const payload = await generateDriverQualificationProof(validParams());
    const v = new DriverProofVerifier({});
    const res = v.verifyProofOffChain(payload, '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', 1);
    assert.equal(res.isValid, false);
    assert.match(res.reason, /not cryptographically bound/);
  });

  test('rejects when the required category exceeds the proven category', async () => {
    const payload = await generateDriverQualificationProof({ ...validParams(), vehicleCategory: 'LCV' });
    const v = new DriverProofVerifier({});
    const res = v.verifyProofOffChain(payload, DRIVER, VEHICLE_CATEGORIES.TRAILER);
    assert.equal(res.isValid, false);
    assert.match(res.reason, /does not meet required class/);
  });

  test('rejects when the proof trip date precedes the schedule date', async () => {
    const payload = await generateDriverQualificationProof(validParams()); // trip 2026-10-15
    const v = new DriverProofVerifier({});
    const res = v.verifyProofOffChain(payload, DRIVER, 1, toEpochDays('2027-01-01'));
    assert.equal(res.isValid, false);
    assert.match(res.reason, /precedes required schedule/);
  });

  test('rejects malformed/missing proof structure without throwing', async () => {
    const v = new DriverProofVerifier({});
    assert.equal(v.verifyProofOffChain(null, DRIVER, 1).isValid, false);
    assert.equal(v.verifyProofOffChain({}, DRIVER, 1).isValid, false);
    const payload = await generateDriverQualificationProof(validParams());
    const broken = JSON.parse(JSON.stringify(payload));
    broken.proof.input = broken.proof.input.slice(0, 2);
    assert.equal(v.verifyProofOffChain(broken, DRIVER, 1).isValid, false);
  });

  test('rejects a zeroed commitment', async () => {
    const payload = await generateDriverQualificationProof(validParams());
    const broken = JSON.parse(JSON.stringify(payload));
    broken.proof.input[3] = '0';
    const v = new DriverProofVerifier({});
    assert.equal(v.verifyProofOffChain(broken, DRIVER, 1).isValid, false);
  });
});
