import { ethers } from 'ethers';
import logger from '../../middleware/logger.js';
import { MerkleTree, sha256Hash } from './MerkleTree.js';
import { escrowRelease } from '../escrow.js';

export const CUSTODY_STATES = Object.freeze({
  ISSUED: 'ISSUED',
  IN_TRANSIT: 'IN_TRANSIT',
  CHECKPOINT_VERIFIED: 'CHECKPOINT_VERIFIED',
  INTERMODAL_TRANSFERRED: 'INTERMODAL_TRANSFERRED',
  FINAL_DISCHARGED: 'FINAL_DISCHARGED',
});

export const SEQUENTIAL_TRANSITION_MAP = Object.freeze({
  [CUSTODY_STATES.ISSUED]: [CUSTODY_STATES.IN_TRANSIT],
  [CUSTODY_STATES.IN_TRANSIT]: [CUSTODY_STATES.CHECKPOINT_VERIFIED],
  [CUSTODY_STATES.CHECKPOINT_VERIFIED]: [CUSTODY_STATES.INTERMODAL_TRANSFERRED],
  [CUSTODY_STATES.INTERMODAL_TRANSFERRED]: [CUSTODY_STATES.FINAL_DISCHARGED],
  [CUSTODY_STATES.FINAL_DISCHARGED]: [],
});

export const EBOL_EIP712_DOMAIN = Object.freeze({
  name: 'Truxify eBL Custody Protocol',
  version: '1',
  chainId: 137, // Polygon Mainnet
  verifyingContract: '0x0000000000000000000000000000000000000000',
});

export const EBOL_EIP712_TYPES = Object.freeze({
  CustodyTransfer: [
    { name: 'ebolId', type: 'string' },
    { name: 'fromActor', type: 'address' },
    { name: 'toActor', type: 'address' },
    { name: 'fromState', type: 'string' },
    { name: 'toState', type: 'string' },
    { name: 'tamperSealRoot', type: 'bytes32' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
});

export class EbolCustodyService {
  constructor() {
    /** @type {Map<string, object>} */
    this.ebols = new Map();
  }

  /**
   * Helper to validate Ethereum address format.
   * @private
   */
  _validateAddress(address, fieldName) {
    if (!address || !ethers.isAddress(address)) {
      throw new Error(`Invalid ${fieldName}: "${address}" is not a valid Ethereum address`);
    }
    return ethers.getAddress(address);
  }

  /**
   * Issues a new electronic Bill of Lading (eBL) in the ISSUED state.
   * Initializes the Merkle tree with the physical cargo tamper seals.
   * 
   * @param {object} params
   * @param {string} params.ebolId - Unique identifier for the eBL
   * @param {string} params.shipperAddress - Shipper Ethereum address
   * @param {string} params.carrierAddress - First carrier / driver Ethereum address
   * @param {string} params.consigneeAddress - Final receiver Ethereum address
   * @param {Array<string>} [params.tamperSeals=[]] - Initial physical tamper seal digests or barcodes
   * @param {string} [params.orderDisplayId] - Associated order display ID for escrow binding
   * @param {object} [params.metadata={}] - Additional shipment metadata
   * @returns {object} Created eBL record
   */
  issueEbol({
    ebolId,
    shipperAddress,
    carrierAddress,
    consigneeAddress,
    tamperSeals = [],
    orderDisplayId = null,
    metadata = {},
  }) {
    if (!ebolId || typeof ebolId !== 'string' || !ebolId.trim()) {
      throw new Error('ebolId is required and must be a non-empty string');
    }

    const cleanEbolId = ebolId.trim();
    if (this.ebols.has(cleanEbolId)) {
      throw new Error(`eBL with ID "${cleanEbolId}" already exists`);
    }

    const validShipper = this._validateAddress(shipperAddress, 'shipperAddress');
    const validCarrier = this._validateAddress(carrierAddress, 'carrierAddress');
    const validConsignee = this._validateAddress(consigneeAddress, 'consigneeAddress');

    const tree = new MerkleTree(tamperSeals);
    const sealRoot = tree.getRoot();

    const timestamp = Math.floor(Date.now() / 1000);

    const record = {
      ebolId: cleanEbolId,
      state: CUSTODY_STATES.ISSUED,
      currentCustodian: validShipper,
      shipperAddress: validShipper,
      carrierAddress: validCarrier,
      consigneeAddress: validConsignee,
      orderDisplayId,
      merkleTree: tree,
      tamperSealRoot: sealRoot,
      nonce: 0,
      metadata,
      auditTrail: [
        {
          fromState: null,
          toState: CUSTODY_STATES.ISSUED,
          fromActor: null,
          toActor: validShipper,
          timestamp,
          tamperSealRoot: sealRoot,
          action: 'EBOL_ISSUED',
        },
      ],
    };

    this.ebols.set(cleanEbolId, record);
    logger.info(`[EbolCustodyService] eBL "${cleanEbolId}" issued with tamper seal root ${sealRoot}`);
    return this.getEbol(cleanEbolId);
  }

  /**
   * Adds an inspection digest or weigh-station token to the eBL's Merkle tree.
   * 
   * @param {string} ebolId - eBL identifier
   * @param {string} inspectionDigest - Weigh station token or checkpoint seal
   * @returns {{leafHash: string, newRoot: string}}
   */
  addInspectionDigest(ebolId, inspectionDigest) {
    const record = this.ebols.get(ebolId);
    if (!record) {
      throw new Error(`eBL "${ebolId}" not found`);
    }

    if (record.state === CUSTODY_STATES.FINAL_DISCHARGED) {
      throw new Error(`Cannot add inspection token to finalized eBL "${ebolId}"`);
    }

    const leafHash = record.merkleTree.addLeaf(inspectionDigest);
    record.tamperSealRoot = record.merkleTree.getRoot();

    logger.info(`[EbolCustodyService] Added inspection digest ${leafHash} to eBL "${ebolId}". New root: ${record.tamperSealRoot}`);

    return {
      leafHash,
      newRoot: record.tamperSealRoot,
    };
  }

  /**
   * Verifies an EIP-712 structured custody transfer signature.
   * 
   * @param {object} params
   * @param {string} params.ebolId
   * @param {string} params.fromActor
   * @param {string} params.toActor
   * @param {string} params.fromState
   * @param {string} params.toState
   * @param {string} params.tamperSealRoot
   * @param {number|string} params.timestamp
   * @param {number} params.nonce
   * @param {string} params.signature - ECDSA secp256k1 hex signature
   * @returns {string} Recovered Ethereum signer address
   */
  verifyCustodySignature({
    ebolId,
    fromActor,
    toActor,
    fromState,
    toState,
    tamperSealRoot,
    timestamp,
    nonce,
    signature,
  }) {
    if (!signature || typeof signature !== 'string') {
      throw new Error('Cryptographic signature is required');
    }

    const value = {
      ebolId,
      fromActor: ethers.getAddress(fromActor),
      toActor: ethers.getAddress(toActor),
      fromState,
      toState,
      tamperSealRoot,
      timestamp: BigInt(timestamp),
      nonce: BigInt(nonce),
    };

    try {
      const recoveredSigner = ethers.verifyTypedData(
        EBOL_EIP712_DOMAIN,
        EBOL_EIP712_TYPES,
        value,
        signature
      );
      return ethers.getAddress(recoveredSigner);
    } catch (err) {
      throw new Error(`EIP-712 signature verification failed: ${err.message}`, { cause: err });
    }
  }

  /**
   * Executes a sequential custody state transition with EIP-712 cryptographic verification.
   * Enforces Merkle tamper-seal verification and triggers escrow release upon FINAL_DISCHARGED.
   * 
   * @param {object} params
   * @param {string} params.ebolId
   * @param {string} params.toState - Target custody state
   * @param {string} params.fromActor - Current custodian releasing custody
   * @param {string} params.toActor - Next custodian accepting custody
   * @param {string} params.signature - EIP-712 signature of the transfer payload
   * @param {number} [params.timestamp] - Transfer timestamp (Unix epoch seconds)
   * @param {number} params.nonce - Sequential nonce
   * @param {object} [params.tamperSealProof] - { leaf, proof } required for FINAL_DISCHARGED
   * @param {string} [params.orderDisplayId] - Optional order display id for escrow payout
   * @returns {Promise<object>} Updated eBL record
   */
  async transitionCustody({
    ebolId,
    toState,
    fromActor,
    toActor,
    signature,
    timestamp = Math.floor(Date.now() / 1000),
    nonce,
    tamperSealProof = null,
    orderDisplayId = null,
  }) {
    const record = this.ebols.get(ebolId);
    if (!record) {
      throw new Error(`eBL "${ebolId}" not found`);
    }

    const currentState = record.state;

    // 1. Sequential State Machine Enforcement
    const allowedNextStates = SEQUENTIAL_TRANSITION_MAP[currentState];
    if (!allowedNextStates || !allowedNextStates.includes(toState)) {
      throw new Error(
        `Invalid custody state transition: Cannot transition from "${currentState}" to "${toState}". Expected sequential state "${allowedNextStates ? allowedNextStates.join(', ') : 'none'}".`
      );
    }

    // 2. Nonce Verification (Replay Protection)
    const expectedNonce = record.nonce + 1;
    if (Number(nonce) !== expectedNonce) {
      throw new Error(`Invalid nonce: Expected ${expectedNonce}, received ${nonce}`);
    }

    const validFromActor = this._validateAddress(fromActor, 'fromActor');
    const validToActor = this._validateAddress(toActor, 'toActor');

    // 3. Custodian Authorization Check
    // The actor releasing custody must be the current custodian
    if (validFromActor.toLowerCase() !== record.currentCustodian.toLowerCase()) {
      throw new Error(
        `Unauthorized custody release: Actor ${validFromActor} is not the current custodian (${record.currentCustodian})`
      );
    }

    // For final discharge, the recipient must be the registered consignee
    if (toState === CUSTODY_STATES.FINAL_DISCHARGED) {
      if (validToActor.toLowerCase() !== record.consigneeAddress.toLowerCase()) {
        throw new Error(
          `Unauthorized final discharge: Destination actor ${validToActor} is not the registered consignee (${record.consigneeAddress})`
        );
      }
    }

    // 4. EIP-712 Digital Signature Verification
    const recoveredSigner = this.verifyCustodySignature({
      ebolId: record.ebolId,
      fromActor: validFromActor,
      toActor: validToActor,
      fromState: currentState,
      toState,
      tamperSealRoot: record.tamperSealRoot,
      timestamp,
      nonce,
      signature,
    });

    // Signature must be provided by the authorized signer (the custodian releasing or consignee discharging)
    const isAuthorizedSigner =
      recoveredSigner.toLowerCase() === validFromActor.toLowerCase() ||
      (toState === CUSTODY_STATES.FINAL_DISCHARGED && recoveredSigner.toLowerCase() === validToActor.toLowerCase());

    if (!isAuthorizedSigner) {
      throw new Error(
        `Cryptographic non-repudiation failure: Signer ${recoveredSigner} is not authorized for this transition`
      );
    }

    // 5. Tamper-Seal & Weigh-Station Digest Verification for FINAL_DISCHARGED
    let sealVerified = false;
    if (toState === CUSTODY_STATES.FINAL_DISCHARGED) {
      if (!tamperSealProof || !tamperSealProof.leaf || !Array.isArray(tamperSealProof.proof)) {
        throw new Error(
          'Missing physical cargo tamper seal or weigh-station proof required for final discharge'
        );
      }

      sealVerified = MerkleTree.verifyProof(
        tamperSealProof.proof,
        tamperSealProof.leaf,
        record.tamperSealRoot
      );

      if (!sealVerified) {
        throw new Error(
          `Tamper-seal cryptographic verification failed: Seal digest ${tamperSealProof.leaf} is not present in Merkle root ${record.tamperSealRoot}`
        );
      }
    }

    // 6. Execute State Transition
    record.state = toState;
    record.currentCustodian = validToActor;
    record.nonce = expectedNonce;

    const transitionAudit = {
      fromState: currentState,
      toState,
      fromActor: validFromActor,
      toActor: validToActor,
      signer: recoveredSigner,
      tamperSealRoot: record.tamperSealRoot,
      timestamp,
      nonce: expectedNonce,
      signature,
      tamperSealVerified: sealVerified,
      action: `TRANSITION_${toState}`,
    };

    // 7. Trustless Escrow Payment Release on FINAL_DISCHARGED
    if (toState === CUSTODY_STATES.FINAL_DISCHARGED) {
      const orderIdForEscrow = orderDisplayId || record.orderDisplayId;
      if (orderIdForEscrow) {
        try {
          const escrowResult = await escrowRelease(orderIdForEscrow);
          transitionAudit.escrowRelease = {
            status: 'EXECUTED',
            bookingId: escrowResult?.bookingId,
            txHash: escrowResult?.txHash,
            alreadyReleased: !!escrowResult?.alreadyReleased,
          };
          logger.info(`[EbolCustodyService] Escrow release executed for order "${orderIdForEscrow}" on eBL discharge`);
        } catch (escrowErr) {
          logger.error(`[EbolCustodyService] Escrow release trigger failed: ${escrowErr.message}`);
          transitionAudit.escrowRelease = {
            status: 'FAILED',
            error: escrowErr.message,
          };
        }
      }
    }

    record.auditTrail.push(transitionAudit);

    logger.info(
      `[EbolCustodyService] eBL "${ebolId}" transitioned: ${currentState} ➔ ${toState} by ${recoveredSigner}`
    );

    return this.getEbol(ebolId);
  }

  /**
   * Verifies an O(log n) inclusion proof for any tamper seal or weigh-station token.
   * 
   * @param {string} ebolId
   * @param {string} leaf
   * @param {Array<object>} proof
   * @returns {boolean}
   */
  verifySealProof(ebolId, leaf, proof) {
    const record = this.ebols.get(ebolId);
    if (!record) {
      throw new Error(`eBL "${ebolId}" not found`);
    }
    return MerkleTree.verifyProof(proof, leaf, record.tamperSealRoot);
  }

  /**
   * Retrieves full eBL details and audit history.
   * 
   * @param {string} ebolId
   * @returns {object|null}
   */
  getEbol(ebolId) {
    const record = this.ebols.get(ebolId);
    if (!record) {
      return null;
    }

    return {
      ebolId: record.ebolId,
      state: record.state,
      currentCustodian: record.currentCustodian,
      shipperAddress: record.shipperAddress,
      carrierAddress: record.carrierAddress,
      consigneeAddress: record.consigneeAddress,
      orderDisplayId: record.orderDisplayId,
      tamperSealRoot: record.tamperSealRoot,
      totalSeals: record.merkleTree.leaves.length,
      nonce: record.nonce,
      metadata: record.metadata,
      auditTrail: record.auditTrail,
    };
  }

  /**
   * Generates a Merkle proof for a registered seal in the eBL.
   * 
   * @param {string} ebolId
   * @param {string|number} leafOrIndex
   * @returns {Array<object>}
   */
  getSealProof(ebolId, leafOrIndex) {
    const record = this.ebols.get(ebolId);
    if (!record) {
      throw new Error(`eBL "${ebolId}" not found`);
    }
    return record.merkleTree.getProof(leafOrIndex);
  }
}

// Global singleton instance for application-wide custody coordination
export const defaultCustodyService = new EbolCustodyService();
export default defaultCustodyService;
