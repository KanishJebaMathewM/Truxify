import { zkDidVerifier } from './did_verifier.js';
import assert from 'assert';
import { ethers } from 'ethers';

console.log('Testing ZK-DID Verifier...');

const address = '0x1234567890123456789012345678901234567890';
const didUri = zkDidVerifier.createDidUri(address);
assert.strictEqual(didUri, `did:truxify:polygon:${address.toLowerCase()}`);

const attrs = { hazmatPermit: true, licenseClass: 'Commercial_Heavy' };
const merkleRoot = zkDidVerifier.generateCredentialMerkleRoot(attrs);
assert.strictEqual(typeof merkleRoot, 'string');

// A genuine proof and nullifier issued for this DID must verify.
const nullifier = zkDidVerifier.generateNullifierHash(didUri);
const proof = zkDidVerifier.generateProofHash(didUri, nullifier);
assert.strictEqual(zkDidVerifier.verifyZkProofOffChain(didUri, proof, nullifier), true);

// Arbitrary non-zero hashes must not verify.
assert.strictEqual(
  zkDidVerifier.verifyZkProofOffChain(didUri, merkleRoot, merkleRoot),
  false
);
assert.strictEqual(
  zkDidVerifier.verifyZkProofOffChain(didUri, ethers.ZeroHash, ethers.ZeroHash),
  false
);
assert.strictEqual(
  zkDidVerifier.verifyZkProofOffChain(didUri, '0x' + 'ff'.repeat(32), '0x' + '11'.repeat(32)),
  false
);

// A genuine proof for a different DID must not verify.
const otherDidUri = zkDidVerifier.createDidUri('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
assert.strictEqual(zkDidVerifier.verifyZkProofOffChain(otherDidUri, proof, nullifier), false);

console.log('✅ ZK-DID Verifier tests passed successfully.');
