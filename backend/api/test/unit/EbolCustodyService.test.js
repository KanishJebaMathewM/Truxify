import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import {
  EbolCustodyService,
  CUSTODY_STATES,
  EBOL_EIP712_DOMAIN,
  EBOL_EIP712_TYPES,
} from '../../src/services/ebol/EbolCustodyService.js';
import {
  MerkleTree,
  sha256Hash,
  combineHashes,
} from '../../src/services/ebol/MerkleTree.js';
import {
  processGeofencedSignature,
} from '../../src/services/smartEbol.js';

// Mock escrow service release function
vi.mock('../../src/services/escrow.js', () => ({
  escrowRelease: vi.fn(async (orderDisplayId) => ({
    bookingId: '0x' + 'b'.repeat(64),
    txHash: '0x' + 'c'.repeat(64),
    orderDisplayId,
  })),
  getEscrowBookingId: vi.fn((orderDisplayId) => '0x' + 'a'.repeat(64)),
}));

describe('MerkleTree & Tamper Seal Engine', () => {
  it('computes deterministic SHA-256 leaf hashes', () => {
    const data = 'SEAL-CONTAINER-4091';
    const hash = sha256Hash(data);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(sha256Hash(data)).toBe(hash);
  });

  it('combines hashes in sorted canonical order', () => {
    const h1 = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const h2 = '0x2222222222222222222222222222222222222222222222222222222222222222';
    const combo1 = combineHashes(h1, h2);
    const combo2 = combineHashes(h2, h1);
    expect(combo1).toBe(combo2);
    expect(combo1).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('builds a balanced binary Merkle tree and derives a root', () => {
    const seals = ['SEAL-01', 'SEAL-02', 'SEAL-03', 'WEIGH-STATION-TN-04'];
    const tree = new MerkleTree(seals);
    const root = tree.getRoot();
    expect(root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(root).not.toBe('0x' + '0'.repeat(64));
  });

  it('generates and verifies O(log n) inclusion proofs for all leaves', () => {
    const seals = ['SEAL-ALPHA', 'SEAL-BETA', 'SEAL-GAMMA', 'SEAL-DELTA', 'SEAL-EPSILON'];
    const tree = new MerkleTree(seals);
    const root = tree.getRoot();

    for (const seal of seals) {
      const proof = tree.getProof(seal);
      expect(proof.length).toBeGreaterThan(0);
      const isValid = MerkleTree.verifyProof(proof, seal, root);
      expect(isValid).toBe(true);
    }
  });

  it('rejects tampered leaves and manipulated proofs', () => {
    const seals = ['SEAL-GENUINE-1', 'SEAL-GENUINE-2', 'SEAL-GENUINE-3'];
    const tree = new MerkleTree(seals);
    const root = tree.getRoot();

    const proof = tree.getProof('SEAL-GENUINE-1');

    // Tampered leaf
    expect(MerkleTree.verifyProof(proof, 'SEAL-BROKEN-TAMPERED', root)).toBe(false);

    // Tampered root
    const fakeRoot = '0x' + 'f'.repeat(64);
    expect(MerkleTree.verifyProof(proof, 'SEAL-GENUINE-1', fakeRoot)).toBe(false);

    // Manipulated proof step
    const corruptedProof = [{ position: 'left', data: '0x' + '0'.repeat(64) }];
    expect(MerkleTree.verifyProof(corruptedProof, 'SEAL-GENUINE-1', root)).toBe(false);
  });

  it('dynamically accumulates checkpoint tokens and updates root', () => {
    const tree = new MerkleTree(['SEAL-ORIGIN-01']);
    const initialRoot = tree.getRoot();

    const checkpointDigest = 'WEIGH-STATION-ST-882-GROSS-42000KG';
    tree.addLeaf(checkpointDigest);
    const updatedRoot = tree.getRoot();

    expect(updatedRoot).not.toBe(initialRoot);
    const proof = tree.getProof(checkpointDigest);
    expect(MerkleTree.verifyProof(proof, checkpointDigest, updatedRoot)).toBe(true);
  });
});

describe('EbolCustodyService - Sequential FSM & EIP-712 Signatures', () => {
  let custodyService;
  let shipperWallet;
  let carrierWallet1;
  let carrierWallet2;
  let consigneeWallet;
  let unauthorizedWallet;

  const ebolId = 'EBOL-DELHI-MUMBAI-2026-X1';
  const initialSeals = ['CARGO-TAMPER-SEAL-8891', 'RFID-CONTAINER-TAG-441'];

  beforeEach(() => {
    custodyService = new EbolCustodyService();
    shipperWallet = ethers.Wallet.createRandom();
    carrierWallet1 = ethers.Wallet.createRandom();
    carrierWallet2 = ethers.Wallet.createRandom();
    consigneeWallet = ethers.Wallet.createRandom();
    unauthorizedWallet = ethers.Wallet.createRandom();
  });

  async function signCustodyTransfer(wallet, {
    ebolId: id,
    fromActor,
    toActor,
    fromState,
    toState,
    tamperSealRoot,
    timestamp,
    nonce,
  }) {
    const value = {
      ebolId: id,
      fromActor: ethers.getAddress(fromActor),
      toActor: ethers.getAddress(toActor),
      fromState,
      toState,
      tamperSealRoot,
      timestamp: BigInt(timestamp),
      nonce: BigInt(nonce),
    };
    return wallet.signTypedData(EBOL_EIP712_DOMAIN, EBOL_EIP712_TYPES, value);
  }

  it('successfully issues an eBL with initial tamper seal Merkle root', () => {
    const record = custodyService.issueEbol({
      ebolId,
      shipperAddress: shipperWallet.address,
      carrierAddress: carrierWallet1.address,
      consigneeAddress: consigneeWallet.address,
      tamperSeals: initialSeals,
      orderDisplayId: '#FF20260919ABCDEF123456',
    });

    expect(record).toBeDefined();
    expect(record.ebolId).toBe(ebolId);
    expect(record.state).toBe(CUSTODY_STATES.ISSUED);
    expect(record.currentCustodian).toBe(shipperWallet.address);
    expect(record.tamperSealRoot).toMatch(/^0x[0-9a-f]{64}$/);
    expect(record.nonce).toBe(0);
    expect(record.auditTrail.length).toBe(1);
    expect(record.auditTrail[0].action).toBe('EBOL_ISSUED');
  });

  it('rejects duplicate eBL issuance with identical ID', () => {
    custodyService.issueEbol({
      ebolId,
      shipperAddress: shipperWallet.address,
      carrierAddress: carrierWallet1.address,
      consigneeAddress: consigneeWallet.address,
      tamperSeals: initialSeals,
    });

    expect(() => {
      custodyService.issueEbol({
        ebolId,
        shipperAddress: shipperWallet.address,
        carrierAddress: carrierWallet1.address,
        consigneeAddress: consigneeWallet.address,
      });
    }).toThrow('already exists');
  });

  it('enforces strict sequential transitions: ISSUED ➔ IN_TRANSIT ➔ CHECKPOINT_VERIFIED ➔ INTERMODAL_TRANSFERRED ➔ FINAL_DISCHARGED', async () => {
    custodyService.issueEbol({
      ebolId,
      shipperAddress: shipperWallet.address,
      carrierAddress: carrierWallet1.address,
      consigneeAddress: consigneeWallet.address,
      tamperSeals: initialSeals,
      orderDisplayId: '#FF20260919ABCDEF123456',
    });

    // 1. ISSUED ➔ IN_TRANSIT (Shipper releases to Carrier 1)
    let currentRecord = custodyService.getEbol(ebolId);
    let timestamp = Math.floor(Date.now() / 1000);
    let sig1 = await signCustodyTransfer(shipperWallet, {
      ebolId,
      fromActor: shipperWallet.address,
      toActor: carrierWallet1.address,
      fromState: CUSTODY_STATES.ISSUED,
      toState: CUSTODY_STATES.IN_TRANSIT,
      tamperSealRoot: currentRecord.tamperSealRoot,
      timestamp,
      nonce: 1,
    });

    let res1 = await custodyService.transitionCustody({
      ebolId,
      toState: CUSTODY_STATES.IN_TRANSIT,
      fromActor: shipperWallet.address,
      toActor: carrierWallet1.address,
      signature: sig1,
      timestamp,
      nonce: 1,
    });

    expect(res1.state).toBe(CUSTODY_STATES.IN_TRANSIT);
    expect(res1.currentCustodian).toBe(carrierWallet1.address);
    expect(res1.nonce).toBe(1);

    // 2. IN_TRANSIT ➔ CHECKPOINT_VERIFIED (Weigh station inspection digest appended)
    const inspectionDigest = 'CHECKPOINT-WEIGH-STATION-NH48-PASS-41500KG';
    custodyService.addInspectionDigest(ebolId, inspectionDigest);

    currentRecord = custodyService.getEbol(ebolId);
    timestamp = Math.floor(Date.now() / 1000);
    let sig2 = await signCustodyTransfer(carrierWallet1, {
      ebolId,
      fromActor: carrierWallet1.address,
      toActor: carrierWallet1.address,
      fromState: CUSTODY_STATES.IN_TRANSIT,
      toState: CUSTODY_STATES.CHECKPOINT_VERIFIED,
      tamperSealRoot: currentRecord.tamperSealRoot,
      timestamp,
      nonce: 2,
    });

    let res2 = await custodyService.transitionCustody({
      ebolId,
      toState: CUSTODY_STATES.CHECKPOINT_VERIFIED,
      fromActor: carrierWallet1.address,
      toActor: carrierWallet1.address,
      signature: sig2,
      timestamp,
      nonce: 2,
    });

    expect(res2.state).toBe(CUSTODY_STATES.CHECKPOINT_VERIFIED);
    expect(res2.nonce).toBe(2);

    // 3. CHECKPOINT_VERIFIED ➔ INTERMODAL_TRANSFERRED (Carrier 1 transfers to Carrier 2 at rail hub)
    currentRecord = custodyService.getEbol(ebolId);
    timestamp = Math.floor(Date.now() / 1000);
    let sig3 = await signCustodyTransfer(carrierWallet1, {
      ebolId,
      fromActor: carrierWallet1.address,
      toActor: carrierWallet2.address,
      fromState: CUSTODY_STATES.CHECKPOINT_VERIFIED,
      toState: CUSTODY_STATES.INTERMODAL_TRANSFERRED,
      tamperSealRoot: currentRecord.tamperSealRoot,
      timestamp,
      nonce: 3,
    });

    let res3 = await custodyService.transitionCustody({
      ebolId,
      toState: CUSTODY_STATES.INTERMODAL_TRANSFERRED,
      fromActor: carrierWallet1.address,
      toActor: carrierWallet2.address,
      signature: sig3,
      timestamp,
      nonce: 3,
    });

    expect(res3.state).toBe(CUSTODY_STATES.INTERMODAL_TRANSFERRED);
    expect(res3.currentCustodian).toBe(carrierWallet2.address);
    expect(res3.nonce).toBe(3);

    // 4. INTERMODAL_TRANSFERRED ➔ FINAL_DISCHARGED (Consignee verifies seal proof and signs discharge)
    currentRecord = custodyService.getEbol(ebolId);
    const originSealProof = custodyService.getSealProof(ebolId, initialSeals[0]);
    expect(originSealProof.length).toBeGreaterThan(0);

    timestamp = Math.floor(Date.now() / 1000);
    let sig4 = await signCustodyTransfer(consigneeWallet, {
      ebolId,
      fromActor: carrierWallet2.address,
      toActor: consigneeWallet.address,
      fromState: CUSTODY_STATES.INTERMODAL_TRANSFERRED,
      toState: CUSTODY_STATES.FINAL_DISCHARGED,
      tamperSealRoot: currentRecord.tamperSealRoot,
      timestamp,
      nonce: 4,
    });

    let res4 = await custodyService.transitionCustody({
      ebolId,
      toState: CUSTODY_STATES.FINAL_DISCHARGED,
      fromActor: carrierWallet2.address,
      toActor: consigneeWallet.address,
      signature: sig4,
      timestamp,
      nonce: 4,
      tamperSealProof: {
        leaf: initialSeals[0],
        proof: originSealProof,
      },
    });

    expect(res4.state).toBe(CUSTODY_STATES.FINAL_DISCHARGED);
    expect(res4.currentCustodian).toBe(consigneeWallet.address);
    expect(res4.nonce).toBe(4);

    // Verify escrow was authorized
    const lastAudit = res4.auditTrail[res4.auditTrail.length - 1];
    expect(lastAudit.action).toBe('TRANSITION_FINAL_DISCHARGED');
    expect(lastAudit.tamperSealVerified).toBe(true);
    expect(lastAudit.escrowRelease.status).toBe('EXECUTED');
  });

  it('rejects out-of-order transition (e.g. ISSUED directly to FINAL_DISCHARGED)', async () => {
    custodyService.issueEbol({
      ebolId,
      shipperAddress: shipperWallet.address,
      carrierAddress: carrierWallet1.address,
      consigneeAddress: consigneeWallet.address,
      tamperSeals: initialSeals,
    });

    const currentRecord = custodyService.getEbol(ebolId);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await signCustodyTransfer(shipperWallet, {
      ebolId,
      fromActor: shipperWallet.address,
      toActor: consigneeWallet.address,
      fromState: CUSTODY_STATES.ISSUED,
      toState: CUSTODY_STATES.FINAL_DISCHARGED,
      tamperSealRoot: currentRecord.tamperSealRoot,
      timestamp,
      nonce: 1,
    });

    await expect(
      custodyService.transitionCustody({
        ebolId,
        toState: CUSTODY_STATES.FINAL_DISCHARGED,
        fromActor: shipperWallet.address,
        toActor: consigneeWallet.address,
        signature,
        timestamp,
        nonce: 1,
        tamperSealProof: { leaf: initialSeals[0], proof: [] },
      })
    ).rejects.toThrow(/Invalid custody state transition/);
  });

  it('rejects transitions signed by unauthorized third-party actors', async () => {
    custodyService.issueEbol({
      ebolId,
      shipperAddress: shipperWallet.address,
      carrierAddress: carrierWallet1.address,
      consigneeAddress: consigneeWallet.address,
      tamperSeals: initialSeals,
    });

    const currentRecord = custodyService.getEbol(ebolId);
    const timestamp = Math.floor(Date.now() / 1000);

    // Unauthorized wallet signs claiming to be shipper
    const fakeSignature = await signCustodyTransfer(unauthorizedWallet, {
      ebolId,
      fromActor: shipperWallet.address,
      toActor: carrierWallet1.address,
      fromState: CUSTODY_STATES.ISSUED,
      toState: CUSTODY_STATES.IN_TRANSIT,
      tamperSealRoot: currentRecord.tamperSealRoot,
      timestamp,
      nonce: 1,
    });

    await expect(
      custodyService.transitionCustody({
        ebolId,
        toState: CUSTODY_STATES.IN_TRANSIT,
        fromActor: shipperWallet.address,
        toActor: carrierWallet1.address,
        signature: fakeSignature,
        timestamp,
        nonce: 1,
      })
    ).rejects.toThrow(/Cryptographic non-repudiation failure/);
  });

  it('rejects stale or replayed nonces', async () => {
    custodyService.issueEbol({
      ebolId,
      shipperAddress: shipperWallet.address,
      carrierAddress: carrierWallet1.address,
      consigneeAddress: consigneeWallet.address,
      tamperSeals: initialSeals,
    });

    const currentRecord = custodyService.getEbol(ebolId);
    const timestamp = Math.floor(Date.now() / 1000);

    const signature = await signCustodyTransfer(shipperWallet, {
      ebolId,
      fromActor: shipperWallet.address,
      toActor: carrierWallet1.address,
      fromState: CUSTODY_STATES.ISSUED,
      toState: CUSTODY_STATES.IN_TRANSIT,
      tamperSealRoot: currentRecord.tamperSealRoot,
      timestamp,
      nonce: 99, // Wrong nonce
    });

    await expect(
      custodyService.transitionCustody({
        ebolId,
        toState: CUSTODY_STATES.IN_TRANSIT,
        fromActor: shipperWallet.address,
        toActor: carrierWallet1.address,
        signature,
        timestamp,
        nonce: 99,
      })
    ).rejects.toThrow(/Invalid nonce: Expected 1, received 99/);
  });

  it('rejects final discharge if tamper seal proof is broken or invalid', async () => {
    // Progress eBL to INTERMODAL_TRANSFERRED
    custodyService.issueEbol({
      ebolId,
      shipperAddress: shipperWallet.address,
      carrierAddress: carrierWallet1.address,
      consigneeAddress: consigneeWallet.address,
      tamperSeals: initialSeals,
    });

    let rec = custodyService.getEbol(ebolId);
    let sig = await signCustodyTransfer(shipperWallet, {
      ebolId,
      fromActor: shipperWallet.address,
      toActor: carrierWallet1.address,
      fromState: CUSTODY_STATES.ISSUED,
      toState: CUSTODY_STATES.IN_TRANSIT,
      tamperSealRoot: rec.tamperSealRoot,
      timestamp: 1000,
      nonce: 1,
    });
    await custodyService.transitionCustody({
      ebolId,
      toState: CUSTODY_STATES.IN_TRANSIT,
      fromActor: shipperWallet.address,
      toActor: carrierWallet1.address,
      signature: sig,
      timestamp: 1000,
      nonce: 1,
    });

    rec = custodyService.getEbol(ebolId);
    sig = await signCustodyTransfer(carrierWallet1, {
      ebolId,
      fromActor: carrierWallet1.address,
      toActor: carrierWallet1.address,
      fromState: CUSTODY_STATES.IN_TRANSIT,
      toState: CUSTODY_STATES.CHECKPOINT_VERIFIED,
      tamperSealRoot: rec.tamperSealRoot,
      timestamp: 2000,
      nonce: 2,
    });
    await custodyService.transitionCustody({
      ebolId,
      toState: CUSTODY_STATES.CHECKPOINT_VERIFIED,
      fromActor: carrierWallet1.address,
      toActor: carrierWallet1.address,
      signature: sig,
      timestamp: 2000,
      nonce: 2,
    });

    rec = custodyService.getEbol(ebolId);
    sig = await signCustodyTransfer(carrierWallet1, {
      ebolId,
      fromActor: carrierWallet1.address,
      toActor: carrierWallet2.address,
      fromState: CUSTODY_STATES.CHECKPOINT_VERIFIED,
      toState: CUSTODY_STATES.INTERMODAL_TRANSFERRED,
      tamperSealRoot: rec.tamperSealRoot,
      timestamp: 3000,
      nonce: 3,
    });
    await custodyService.transitionCustody({
      ebolId,
      toState: CUSTODY_STATES.INTERMODAL_TRANSFERRED,
      fromActor: carrierWallet1.address,
      toActor: carrierWallet2.address,
      signature: sig,
      timestamp: 3000,
      nonce: 3,
    });

    // Try FINAL_DISCHARGED with broken tamper seal proof
    rec = custodyService.getEbol(ebolId);
    const validProof = custodyService.getSealProof(ebolId, initialSeals[0]);
    sig = await signCustodyTransfer(consigneeWallet, {
      ebolId,
      fromActor: carrierWallet2.address,
      toActor: consigneeWallet.address,
      fromState: CUSTODY_STATES.INTERMODAL_TRANSFERRED,
      toState: CUSTODY_STATES.FINAL_DISCHARGED,
      tamperSealRoot: rec.tamperSealRoot,
      timestamp: 4000,
      nonce: 4,
    });

    await expect(
      custodyService.transitionCustody({
        ebolId,
        toState: CUSTODY_STATES.FINAL_DISCHARGED,
        fromActor: carrierWallet2.address,
        toActor: consigneeWallet.address,
        signature: sig,
        timestamp: 4000,
        nonce: 4,
        tamperSealProof: {
          leaf: 'TAMPERED-CONTAINER-SEAL-BROKEN',
          proof: validProof,
        },
      })
    ).rejects.toThrow(/Tamper-seal cryptographic verification failed/);
  });

  it('rejects further transitions once FINAL_DISCHARGED terminal state is reached', async () => {
    // Complete full lifecycle to FINAL_DISCHARGED
    custodyService.issueEbol({
      ebolId,
      shipperAddress: shipperWallet.address,
      carrierAddress: carrierWallet1.address,
      consigneeAddress: consigneeWallet.address,
      tamperSeals: initialSeals,
    });

    // 1. ISSUED -> IN_TRANSIT
    let rec = custodyService.getEbol(ebolId);
    let sig = await signCustodyTransfer(shipperWallet, {
      ebolId,
      fromActor: shipperWallet.address,
      toActor: carrierWallet1.address,
      fromState: CUSTODY_STATES.ISSUED,
      toState: CUSTODY_STATES.IN_TRANSIT,
      tamperSealRoot: rec.tamperSealRoot,
      timestamp: 1000,
      nonce: 1,
    });
    await custodyService.transitionCustody({
      ebolId,
      toState: CUSTODY_STATES.IN_TRANSIT,
      fromActor: shipperWallet.address,
      toActor: carrierWallet1.address,
      signature: sig,
      timestamp: 1000,
      nonce: 1,
    });

    // 2. IN_TRANSIT -> CHECKPOINT_VERIFIED
    rec = custodyService.getEbol(ebolId);
    sig = await signCustodyTransfer(carrierWallet1, {
      ebolId,
      fromActor: carrierWallet1.address,
      toActor: carrierWallet1.address,
      fromState: CUSTODY_STATES.IN_TRANSIT,
      toState: CUSTODY_STATES.CHECKPOINT_VERIFIED,
      tamperSealRoot: rec.tamperSealRoot,
      timestamp: 2000,
      nonce: 2,
    });
    await custodyService.transitionCustody({
      ebolId,
      toState: CUSTODY_STATES.CHECKPOINT_VERIFIED,
      fromActor: carrierWallet1.address,
      toActor: carrierWallet1.address,
      signature: sig,
      timestamp: 2000,
      nonce: 2,
    });

    // 3. CHECKPOINT_VERIFIED -> INTERMODAL_TRANSFERRED
    rec = custodyService.getEbol(ebolId);
    sig = await signCustodyTransfer(carrierWallet1, {
      ebolId,
      fromActor: carrierWallet1.address,
      toActor: carrierWallet2.address,
      fromState: CUSTODY_STATES.CHECKPOINT_VERIFIED,
      toState: CUSTODY_STATES.INTERMODAL_TRANSFERRED,
      tamperSealRoot: rec.tamperSealRoot,
      timestamp: 3000,
      nonce: 3,
    });
    await custodyService.transitionCustody({
      ebolId,
      toState: CUSTODY_STATES.INTERMODAL_TRANSFERRED,
      fromActor: carrierWallet1.address,
      toActor: carrierWallet2.address,
      signature: sig,
      timestamp: 3000,
      nonce: 3,
    });

    // 4. INTERMODAL_TRANSFERRED -> FINAL_DISCHARGED
    rec = custodyService.getEbol(ebolId);
    const proof = custodyService.getSealProof(ebolId, initialSeals[0]);
    sig = await signCustodyTransfer(consigneeWallet, {
      ebolId,
      fromActor: carrierWallet2.address,
      toActor: consigneeWallet.address,
      fromState: CUSTODY_STATES.INTERMODAL_TRANSFERRED,
      toState: CUSTODY_STATES.FINAL_DISCHARGED,
      tamperSealRoot: rec.tamperSealRoot,
      timestamp: 4000,
      nonce: 4,
    });
    await custodyService.transitionCustody({
      ebolId,
      toState: CUSTODY_STATES.FINAL_DISCHARGED,
      fromActor: carrierWallet2.address,
      toActor: consigneeWallet.address,
      signature: sig,
      timestamp: 4000,
      nonce: 4,
      tamperSealProof: { leaf: initialSeals[0], proof },
    });

    // Try transitioning from FINAL_DISCHARGED
    rec = custodyService.getEbol(ebolId);
    sig = await signCustodyTransfer(consigneeWallet, {
      ebolId,
      fromActor: consigneeWallet.address,
      toActor: shipperWallet.address,
      fromState: CUSTODY_STATES.FINAL_DISCHARGED,
      toState: CUSTODY_STATES.IN_TRANSIT,
      tamperSealRoot: rec.tamperSealRoot,
      timestamp: 5000,
      nonce: 5,
    });

    await expect(
      custodyService.transitionCustody({
        ebolId,
        toState: CUSTODY_STATES.IN_TRANSIT,
        fromActor: consigneeWallet.address,
        toActor: shipperWallet.address,
        signature: sig,
        timestamp: 5000,
        nonce: 5,
      })
    ).rejects.toThrow(/Invalid custody state transition/);
  });
});

describe('smartEbol - Geofenced Signature with Cryptographic Non-Repudiation', () => {
  let custodyService;
  let signerWallet;

  beforeEach(() => {
    custodyService = new EbolCustodyService();
    signerWallet = ethers.Wallet.createRandom();
  });

  it('validates geofenced delivery signature with cryptographic EIP-712 proof', async () => {
    const ebolId = 'EBOL-GEO-CRYPTO-1';
    const facilityCoords = { latitude: 28.6139, longitude: 77.209 };
    const receiverCoordsInside = { latitude: 28.6143, longitude: 77.209 };

    const seal = 'SEAL-GEO-SECURE-99';
    custodyService.issueEbol({
      ebolId,
      shipperAddress: signerWallet.address,
      carrierAddress: signerWallet.address,
      consigneeAddress: signerWallet.address,
      tamperSeals: [seal],
    });

    const ebolRecord = custodyService.getEbol(ebolId);
    const sealProof = custodyService.getSealProof(ebolId, seal);

    const timestamp = Math.floor(Date.now() / 1000);
    const value = {
      ebolId,
      fromActor: signerWallet.address,
      toActor: signerWallet.address,
      fromState: ebolRecord.state,
      toState: CUSTODY_STATES.FINAL_DISCHARGED,
      tamperSealRoot: ebolRecord.tamperSealRoot,
      timestamp: BigInt(timestamp),
      nonce: 1n,
    };
    const eip712Sig = await signerWallet.signTypedData(EBOL_EIP712_DOMAIN, EBOL_EIP712_TYPES, value);

    const result = processGeofencedSignature({
      ebolId,
      receiverId: signerWallet.address,
      receiverName: 'Authorized Consignee',
      facilityCoordinates: facilityCoords,
      receiverCoordinates: receiverCoordsInside,
      signerAddress: signerWallet.address,
      fromActor: signerWallet.address,
      eip712Signature: eip712Sig,
      tamperSealProof: { leaf: seal, proof: sealProof },
      nonce: 1,
      custodyService,
    });

    expect(result.signed).toBe(true);
    expect(result.data.status).toBe('DELIVERED_AND_SIGNED');
    expect(result.data.cryptographicProof).toBeDefined();
    expect(result.data.cryptographicProof.algorithm).toBe('secp256k1-EIP712');
    expect(result.data.cryptographicProof.recoveredSigner.toLowerCase()).toBe(signerWallet.address.toLowerCase());
    expect(result.data.cryptographicProof.tamperSealVerified).toBe(true);
  });

  it('rejects delivery signature if EIP-712 cryptographic signature is malformed', () => {
    const facilityCoords = { latitude: 28.6139, longitude: 77.209 };
    const receiverCoordsInside = { latitude: 28.6143, longitude: 77.209 };

    const result = processGeofencedSignature({
      ebolId: 'EBOL-GEO-BAD-SIG',
      receiverId: signerWallet.address,
      facilityCoordinates: facilityCoords,
      receiverCoordinates: receiverCoordsInside,
      eip712Signature: '0xinvalid_signature',
      custodyService,
    });

    expect(result.signed).toBe(false);
    expect(result.reason).toBe('CRYPTOGRAPHIC_SIGNATURE_INVALID');
  });
});
