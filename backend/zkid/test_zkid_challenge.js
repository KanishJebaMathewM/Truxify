import assert from 'assert';
import { ethers } from 'ethers';
import {
    ZKID_CHALLENGE_DOMAIN,
    ZKID_CHALLENGE_TTL_SECONDS,
    buildVerificationChallenge,
    validateVerificationChallenge,
    recoverChallengeSigner
} from './verificationChallenge.js';

const contractAddress = '0x0000000000000000000000000000000000000001';
const identityHash = ethers.keccak256(ethers.toUtf8Bytes('identity'));
const credentialHash = ethers.keccak256(ethers.toUtf8Bytes('credential'));
const nonce = ethers.hexlify(ethers.randomBytes(32));
const issuedAt = 1_700_000_000;
const expiresAt = issuedAt + ZKID_CHALLENGE_TTL_SECONDS;
const chainId = 31337;

const challenge = buildVerificationChallenge({
    identityHash,
    credentialHash,
    nonce,
    issuedAt,
    expiresAt,
    chainId,
    contractAddress
});

const signer = ethers.Wallet.createRandom();
const proofData = await signer.signMessage(ethers.getBytes(challenge));
const recovered = recoverChallengeSigner(proofData, challenge);
assert.strictEqual(recovered.verified, true);
assert.strictEqual(recovered.prover.toLowerCase(), signer.address.toLowerCase());

const challengeData = {
    domain: ZKID_CHALLENGE_DOMAIN,
    chainId,
    contractAddress,
    identityHash,
    credentialHash,
    nonce,
    issuedAt,
    expiresAt,
    challenge
};

assert.deepStrictEqual(
    (await validateVerificationChallenge({
        challengeData,
        identityHash,
        credentialHash,
        zkidAddress: contractAddress,
        expectedChainId: chainId,
        now: issuedAt + 1
    })).valid,
    true
);

assert.strictEqual(
    (await validateVerificationChallenge({
        challengeData: { ...challengeData, contractAddress: '0x0000000000000000000000000000000000000002' },
        identityHash,
        credentialHash,
        zkidAddress: contractAddress,
        expectedChainId: chainId,
        now: issuedAt + 1
    })).reason,
    'Challenge contract does not match verifier'
);

assert.strictEqual(
    (await validateVerificationChallenge({
        challengeData: { ...challengeData, chainId: 1 },
        identityHash,
        credentialHash,
        zkidAddress: contractAddress,
        expectedChainId: chainId,
        now: issuedAt + 1
    })).reason,
    'Challenge chain does not match verifier'
);

assert.strictEqual(
    (await validateVerificationChallenge({
        challengeData,
        identityHash,
        credentialHash,
        zkidAddress: contractAddress,
        expectedChainId: chainId,
        now: expiresAt
    })).reason,
    'Verification challenge has expired'
);

assert.strictEqual(
    (await validateVerificationChallenge({
        challengeData: { ...challengeData, nonce: ethers.hexlify(ethers.randomBytes(32)) },
        identityHash,
        credentialHash,
        zkidAddress: contractAddress,
        expectedChainId: chainId,
        now: issuedAt + 1
    })).reason,
    'Verification challenge digest mismatch'
);

assert.strictEqual(
    (await validateVerificationChallenge({
        challengeData,
        identityHash,
        credentialHash,
        zkidAddress: contractAddress,
        expectedChainId: chainId,
        now: issuedAt + 1
    })).valid,
    true
);

console.log('ZK-ID replay-resistant challenge tests passed.');
