import assert from 'assert';
import { ethers } from 'ethers';
import { buildVerificationChallenge, recoverVerificationSigner, verifyProofOwnership } from './proofVerifier.js';

const identityHash = ethers.keccak256(ethers.toUtf8Bytes('identity'));
const credentialHash = ethers.keccak256(ethers.toUtf8Bytes('credential'));
const challenge = buildVerificationChallenge(identityHash, credentialHash);

const owner = ethers.Wallet.createRandom();
const unrelatedSigner = ethers.Wallet.createRandom();
const activeIdentity = {
    identityHash,
    owner: owner.address,
    isActive: true
};

const validProof = await owner.signMessage(ethers.getBytes(challenge));
const recovered = recoverVerificationSigner(validProof, identityHash, credentialHash);
assert.strictEqual(recovered.verified, true);
assert.strictEqual(recovered.prover.toLowerCase(), owner.address.toLowerCase());

const ownershipResult = verifyProofOwnership(
    validProof,
    identityHash,
    credentialHash,
    activeIdentity
);
assert.strictEqual(ownershipResult.verified, true);
assert.strictEqual(ownershipResult.prover.toLowerCase(), owner.address.toLowerCase());

const forgedProof = await unrelatedSigner.signMessage(ethers.getBytes(challenge));
const mismatchResult = verifyProofOwnership(
    forgedProof,
    identityHash,
    credentialHash,
    activeIdentity
);
assert.strictEqual(mismatchResult.verified, false);
assert.strictEqual(mismatchResult.reason, 'Proof signer does not own the registered identity');

const unknownIdentityResult = verifyProofOwnership(
    validProof,
    identityHash,
    credentialHash,
    null
);
assert.strictEqual(unknownIdentityResult.verified, false);
assert.strictEqual(unknownIdentityResult.reason, 'Identity not found');

const revokedIdentityResult = verifyProofOwnership(
    validProof,
    identityHash,
    credentialHash,
    { ...activeIdentity, isActive: false }
);
assert.strictEqual(revokedIdentityResult.verified, false);
assert.strictEqual(revokedIdentityResult.reason, 'Identity is revoked');

console.log('ZK-ID signer ownership tests passed.');
