import { ethers } from 'ethers';
import logger from '../api/src/middleware/logger.js';
import { VEHICLE_CATEGORIES } from './driverProofGenerator.js';

/**
 * DriverProofVerifier: High-Performance Verification Engine for Driver ZK Proofs
 */
export class DriverProofVerifier {
  /**
   * @param {object} [options={}]
   * @param {string} [options.rpcUrl]
   * @param {string} [options.contractAddress]
   */
  constructor(options = {}) {
    this.rpcUrl = options.rpcUrl || process.env.POLYGON_RPC_URL;
    this.contractAddress = options.contractAddress || process.env.DRIVER_QUALIFICATION_VERIFIER_ADDRESS;
  }

  /**
   * Fast off-chain validation of driver Groth16 proof structure and public signals.
   * 
   * @param {object} proofPayload
   * @param {object} proofPayload.proof - Groth16 proof {a, b, c, input}
   * @param {string} expectedDriverAddress - Expected driver Ethereum address
   * @param {number} [requiredCategory=1] - Required category (1=LCV, 2=HCV)
   * @param {number} [tripEpochDays] - Scheduled trip date
   * @returns {object} { isValid: boolean, reason?: string, details?: object }
   */
  verifyProofOffChain(proofPayload, expectedDriverAddress, requiredCategory = 1, tripEpochDays = null) {
    try {
      if (!proofPayload || !proofPayload.proof) {
        return { isValid: false, reason: 'Missing proof payload' };
      }

      const { proof } = proofPayload;
      const { a, b, c, input } = proof;

      // 1. Basic structural checks
      if (!Array.isArray(a) || !Array.isArray(b) || !Array.isArray(c) || !Array.isArray(input)) {
        return { isValid: false, reason: 'Malformed Groth16 proof arrays' };
      }

      if (input.length < 4) {
        return { isValid: false, reason: 'Incomplete public input signals (expected 4 signals)' };
      }

      // 2. Validate Driver Address Binding (input[0])
      const expectedAddrBigInt = BigInt(expectedDriverAddress);
      const proofDriverAddrBigInt = BigInt(input[0]);

      if (expectedAddrBigInt !== proofDriverAddrBigInt) {
        return {
          isValid: false,
          reason: 'Proof not cryptographically bound to the requested driver address',
        };
      }

      // 3. Validate Trip Date (input[1])
      const currentTripDays = parseInt(input[1], 10);
      if (tripEpochDays !== null && currentTripDays < tripEpochDays) {
        return {
          isValid: false,
          reason: `Proof trip date (${currentTripDays}) precedes required schedule date (${tripEpochDays})`,
        };
      }

      // 4. Validate Vehicle Category (input[2])
      const proofCategory = parseInt(input[2], 10);
      if (proofCategory < requiredCategory) {
        return {
          isValid: false,
          reason: `Driver vehicle class (${proofCategory}) does not meet required class (${requiredCategory})`,
        };
      }

      // 5. Non-zero commitment check (input[3])
      const commitment = input[3];
      if (!commitment || commitment === '0') {
        return { isValid: false, reason: 'Invalid or null identity commitment' };
      }

      return {
        isValid: true,
        details: {
          driverAddress: ethers.getAddress(expectedDriverAddress),
          tripEpochDays: currentTripDays,
          vehicleCategory: proofCategory,
          commitmentHash: commitment,
          verifiedAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      logger.error({ err }, '[DriverProofVerifier] Error during off-chain verification');
      return { isValid: false, reason: `Verification exception: ${err.message}` };
    }
  }

  /**
   * On-chain verification using deployed Polygon contract.
   * 
   * @param {object} proofPayload
   * @param {string} driverAddress
   * @param {number} validUntilEpochDays
   * @param {ethers.Signer} signer
   * @returns {Promise<object>}
   */
  async verifyAndAttestOnChain(proofPayload, driverAddress, validUntilEpochDays, signer) {
    if (!this.contractAddress) {
      throw new Error('DRIVER_QUALIFICATION_VERIFIER_ADDRESS not configured');
    }

    const abi = [
      'function verifyAndAttest(uint[2] a, uint[2][2] b, uint[2] c, uint[4] input, address driver, uint256 validUntilEpochDays) external returns (bool)',
      'function isDriverQualifiedForTrip(address driver, uint8 requiredCategory, uint256 tripEpochDays) external view returns (bool)'
    ];

    const contract = new ethers.Contract(this.contractAddress, abi, signer);
    const { proof } = proofPayload;

    const tx = await contract.verifyAndAttest(
      proof.a,
      proof.b,
      proof.c,
      proof.input,
      driverAddress,
      validUntilEpochDays
    );

    const receipt = await tx.wait();
    return {
      success: true,
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
    };
  }
}

export default DriverProofVerifier;
