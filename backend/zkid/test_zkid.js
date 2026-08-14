import { zkDidVerifier } from './did_verifier.js';
import assert from 'assert';

console.log('Testing ZK-DID Verifier...');

const address = '0x1234567890123456789012345678901234567890';
const didUri = zkDidVerifier.createDidUri(address);
assert.strictEqual(didUri, `did:truxify:polygon:${address.toLowerCase()}`);

const attrs = { hazmatPermit: true, licenseClass: 'Commercial_Heavy' };
const merkleRoot = zkDidVerifier.generateCredentialMerkleRoot(attrs);
assert.strictEqual(typeof merkleRoot, 'string');

const isValid = zkDidVerifier.verifyZkProofOffChain(didUri, merkleRoot, merkleRoot);
assert.strictEqual(isValid, true);

console.log('✅ ZK-DID Verifier tests passed successfully.');
