import { zkDidVerifier } from './did_verifier.js';
import { ethers } from 'ethers';
import assert from 'assert';

console.log('Running Comprehensive ZK-DID Verifier Tests...');

// 1. Test DID URI Generation
const address = '0x1234567890123456789012345678901234567890';
const didUri = zkDidVerifier.createDidUri(address);
assert.strictEqual(didUri, `did:truxify:polygon:${address.toLowerCase()}`);

// 2. Test Credential Merkle Root Generation
const attrs = { hazmatPermit: true, licenseClass: 'Commercial_Heavy' };
const merkleRoot = zkDidVerifier.generateCredentialMerkleRoot(attrs);
assert.strictEqual(typeof merkleRoot, 'string');
assert.ok(merkleRoot.startsWith('0x'));

// 3. Test Valid Off-Chain ZK Proof Verification (#14775)
const mockProof = '0x123456abcdef';
const mockPublicInputs = [1001, 2002];
const mockNullifier = ethers.keccak256(ethers.toUtf8Bytes('nullifier-secure-99'));

const isValid = zkDidVerifier.verifyZkProofOffChain(didUri, mockProof, mockPublicInputs, mockNullifier);
assert.strictEqual(isValid, true);

// 4. Test Negative Cases (Fail-Closed Validation)
const invalidProofResult = zkDidVerifier.verifyZkProofOffChain(didUri, '0x', mockPublicInputs, mockNullifier);
assert.strictEqual(invalidProofResult, false);

const emptyInputsResult = zkDidVerifier.verifyZkProofOffChain(didUri, mockProof, [], mockNullifier);
assert.strictEqual(emptyInputsResult, false);

const invalidNullifierResult = zkDidVerifier.verifyZkProofOffChain(didUri, mockProof, mockPublicInputs, ethers.ZeroHash);
assert.strictEqual(invalidNullifierResult, false);

console.log('✅ All ZK-DID Verifier test cases passed successfully with strict input guarding.');
