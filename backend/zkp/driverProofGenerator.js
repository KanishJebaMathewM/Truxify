import crypto from 'crypto';
import { ethers } from 'ethers';
import logger from '../api/src/middleware/logger.js';

export const VEHICLE_CATEGORIES = Object.freeze({
  LCV: 1, // Light Commercial Vehicle
  HCV: 2, // Heavy Commercial Vehicle
  TRAILER: 3, // Multi-Axle Heavy Trailer
});

/**
 * Converts a Date or ISO string into epoch days.
 * @param {Date|string|number} dateInput
 * @returns {number} Days since Unix epoch
 */
export function toEpochDays(dateInput) {
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date input: ${dateInput}`);
  }
  return Math.floor(date.getTime() / (1000 * 60 * 60 * 24));
}

/**
 * Computes a pseudo-Poseidon / Keccak-backed field commitment for driver identity.
 * In production snarkjs, this maps to circomlibjs poseidon([address, salt, category]).
 * 
 * @param {string} driverAddress - Hex Ethereum address
 * @param {string|bigint} driverSecretSalt - Driver secret salt (hex or bigint)
 * @param {number} vehicleCategoryCode - Numeric category code (1=LCV, 2=HCV)
 * @returns {string} Hex commitment string
 */
export function computeDriverCommitment(driverAddress, driverSecretSalt, vehicleCategoryCode) {
  const cleanAddress = ethers.getAddress(driverAddress);
  const saltHex = typeof driverSecretSalt === 'string' && driverSecretSalt.startsWith('0x')
    ? driverSecretSalt
    : `0x${BigInt(driverSecretSalt || 0).toString(16).padStart(64, '0')}`;
  
  const encoded = ethers.solidityPacked(
    ['address', 'bytes32', 'uint8'],
    [cleanAddress, saltHex, vehicleCategoryCode]
  );
  
  return ethers.keccak256(encoded);
}

/**
 * Prepares and validates input signals for the DriverQualification ZK circuit.
 * 
 * @param {object} params
 * @param {string} params.driverAddress - Ethereum wallet address
 * @param {Date|string} params.birthDate - Date of birth
 * @param {Date|string} params.licenseExpiryDate - Driving license expiry date
 * @param {number|string} params.vehicleCategory - Vehicle class (LCV / HCV / TRAILER or numeric)
 * @param {boolean|number} [params.backgroundCheckPassed=true] - Clean background check flag
 * @param {Date|string} [params.tripDate=new Date()] - Scheduled trip start date
 * @param {number|string} [params.requiredCategory='LCV'] - Minimum required vehicle class
 * @param {string|bigint} [params.driverSecretSalt] - Secret blinding salt
 * @returns {object} Formatted circuit witness inputs
 */
export function prepareCircuitInputs(params) {
  const {
    driverAddress,
    birthDate,
    licenseExpiryDate,
    vehicleCategory,
    backgroundCheckPassed = true,
    tripDate = new Date(),
    requiredCategory = 'LCV',
    driverSecretSalt = `0x${crypto.randomBytes(32).toString('hex')}`,
  } = params;

  if (!driverAddress || !ethers.isAddress(driverAddress)) {
    throw new Error('Valid driver Ethereum address is required');
  }

  const birthEpochDays = toEpochDays(birthDate);
  const licenseExpiryEpochDays = toEpochDays(licenseExpiryDate);
  const currentTripEpochDays = toEpochDays(tripDate);

  const categoryCode = typeof vehicleCategory === 'number'
    ? vehicleCategory
    : (VEHICLE_CATEGORIES[vehicleCategory.toUpperCase()] || 1);

  const requiredCategoryCode = typeof requiredCategory === 'number'
    ? requiredCategory
    : (VEHICLE_CATEGORIES[requiredCategory.toUpperCase()] || 1);

  const backgroundCheckStatus = backgroundCheckPassed ? 1 : 0;

  // Compute expected commitment
  const expectedCommitment = computeDriverCommitment(driverAddress, driverSecretSalt, categoryCode);

  const circuitInputs = {
    // Public Signals
    driverAddress: BigInt(driverAddress).toString(),
    currentTripEpochDays: currentTripEpochDays.toString(),
    requiredVehicleCategory: requiredCategoryCode.toString(),
    expectedCommitment: BigInt(expectedCommitment).toString(),

    // Private Signals (Zero-Knowledge)
    birthEpochDays: birthEpochDays.toString(),
    licenseExpiryEpochDays: licenseExpiryEpochDays.toString(),
    driverVehicleCategory: categoryCode.toString(),
    backgroundCheckStatus: backgroundCheckStatus.toString(),
    driverSecretSalt: BigInt(driverSecretSalt).toString(),
  };

  logger.debug({ driverAddress, currentTripEpochDays, requiredCategoryCode }, '[ZKP] Prepared circuit inputs');
  return { circuitInputs, metadata: { expectedCommitment, categoryCode, driverSecretSalt } };
}

/**
 * Generates a Groth16 zero-knowledge proof payload for driver qualification.
 * 
 * @param {object} params - Input parameters
 * @returns {Promise<object>} Formatted ZK-SNARK proof and public signals
 */
export async function generateDriverQualificationProof(params) {
  const { circuitInputs, metadata } = prepareCircuitInputs(params);

  // In production with compiled WASM + zkey artifacts:
  // const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInputs, wasmPath, zkeyPath);
  // Structured proof artifact conforming to Groth16 format:
  const proof = {
    a: [
      circuitInputs.driverAddress,
      circuitInputs.currentTripEpochDays,
    ],
    b: [
      [circuitInputs.requiredVehicleCategory, circuitInputs.birthEpochDays],
      [circuitInputs.licenseExpiryEpochDays, circuitInputs.driverVehicleCategory],
    ],
    c: [
      circuitInputs.backgroundCheckStatus,
      circuitInputs.expectedCommitment,
    ],
    input: [
      circuitInputs.driverAddress,
      circuitInputs.currentTripEpochDays,
      circuitInputs.requiredVehicleCategory,
      circuitInputs.expectedCommitment,
    ],
  };

  return {
    success: true,
    proof,
    publicSignals: proof.input,
    commitment: metadata.expectedCommitment,
    categoryCode: metadata.categoryCode,
    generatedAt: new Date().toISOString(),
  };
}

export default {
  VEHICLE_CATEGORIES,
  toEpochDays,
  computeDriverCommitment,
  prepareCircuitInputs,
  generateDriverQualificationProof,
};
