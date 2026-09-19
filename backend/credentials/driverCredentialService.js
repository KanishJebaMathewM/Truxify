import crypto from 'crypto';
import { ethers } from 'ethers';
import logger from '../api/src/middleware/logger.js';
import { DriverProofVerifier } from '../zkp/driverProofVerifier.js';
import { toEpochDays, VEHICLE_CATEGORIES } from '../zkp/driverProofGenerator.js';

/**
 * DriverCredentialService: W3C Verifiable Credential Issuer for Zero-Knowledge Qualifications
 */
export class DriverCredentialService {
  constructor(options = {}) {
    this.issuerDid = options.issuerDid || 'did:truxify:issuer:authority';
    this.verifier = new DriverProofVerifier(options);
  }

  /**
   * Formats a standard Truxify Driver DID from an Ethereum wallet address.
   * @param {string} driverAddress
   * @returns {string} did:truxify:<address>
   */
  formatDriverDid(driverAddress) {
    return `did:truxify:${ethers.getAddress(driverAddress).toLowerCase()}`;
  }

  /**
   * Issues a W3C-compliant Verifiable Credential based on an authorized ZK proof.
   * 
   * @param {object} params
   * @param {string} params.driverAddress - Ethereum wallet address of driver
   * @param {object} params.proofPayload - Groth16 proof payload
   * @param {Date|string} params.validUntil - Expiration date of the credential
   * @param {number|string} [params.requiredCategory='LCV'] - Vehicle category
   * @returns {Promise<object>} Signed Verifiable Credential
   */
  async issueQualificationCredential(params) {
    const {
      driverAddress,
      proofPayload,
      validUntil,
      requiredCategory = 'LCV',
    } = params;

    const categoryCode = typeof requiredCategory === 'number'
      ? requiredCategory
      : (VEHICLE_CATEGORIES[requiredCategory.toUpperCase()] || 1);

    const tripEpochDays = toEpochDays(new Date());

    // 1. Verify proof before issuance
    const verification = this.verifier.verifyProofOffChain(
      proofPayload,
      driverAddress,
      categoryCode,
      tripEpochDays
    );

    if (!verification.isValid) {
      throw new Error(`ZK Verification failed: ${verification.reason}`);
    }

    const driverDid = this.formatDriverDid(driverAddress);
    const credentialId = `urn:uuid:${crypto.randomUUID()}`;
    const issuanceDate = new Date().toISOString();
    const expirationDate = new Date(validUntil).toISOString();

    // 2. Build W3C Verifiable Credential (Zero-PII)
    const verifiableCredential = {
      '@context': [
        'https://www.w3.org/2018/credentials/v1',
        'https://schema.truxify.com/credentials/v1',
      ],
      id: credentialId,
      type: ['VerifiableCredential', 'DriverCommercialQualificationCredential'],
      issuer: this.issuerDid,
      issuanceDate,
      expirationDate,
      credentialSubject: {
        id: driverDid,
        qualificationStatus: 'VERIFIED',
        vehicleCategory: verification.details.vehicleCategory,
        vehicleCategoryLabel: Object.keys(VEHICLE_CATEGORIES).find(
          (k) => VEHICLE_CATEGORIES[k] === verification.details.vehicleCategory
        ) || 'LCV',
        identityCommitment: verification.details.commitmentHash,
        ageCompliance: '>=21',
        backgroundCheckCompliance: 'CLEAN',
        licenseExpiryCompliance: 'VALID_FOR_TRIP',
      },
      evidence: [
        {
          id: `${credentialId}#zk-snark`,
          type: ['Groth16ZeroKnowledgeProofVerification'],
          verifier: 'DriverProofVerifier',
          verifiedAt: verification.details.verifiedAt,
          proofBindingAddress: verification.details.driverAddress,
        },
      ],
    };

    // 3. Generate Credential Hash / Proof Signature
    const credentialHash = ethers.keccak256(
      ethers.toUtf8Bytes(JSON.stringify(verifiableCredential.credentialSubject))
    );

    verifiableCredential.proof = {
      type: 'JsonWebSignature2020',
      created: issuanceDate,
      proofPurpose: 'assertionMethod',
      verificationMethod: `${this.issuerDid}#key-1`,
      jws: credentialHash, // In production: signed by issuer private key
    };

    logger.info({ driverDid, credentialId }, '[DriverCredentialService] Issued ZK Driver Qualification Credential');
    return verifiableCredential;
  }
}

export default DriverCredentialService;
