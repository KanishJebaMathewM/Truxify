import { ethers } from 'ethers';

export function buildVerificationChallenge(identityHash, credentialHash) {
    return ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ['bytes32', 'bytes32'],
            [identityHash, credentialHash]
        )
    );
}

export function recoverVerificationSigner(proofData, identityHash, credentialHash) {
    if (!proofData || !ethers.isHexString(proofData) || proofData === ethers.ZeroHash) {
        return { verified: false, reason: 'Missing or invalid proofData' };
    }

    try {
        const challenge = buildVerificationChallenge(identityHash, credentialHash);
        const prover = ethers.verifyMessage(ethers.getBytes(challenge), proofData);
        return { verified: true, prover };
    } catch {
        return { verified: false, reason: 'Proof signature recovery failed' };
    }
}

export function verifyProofOwnership(proofData, identityHash, credentialHash, identity) {
    const recovered = recoverVerificationSigner(proofData, identityHash, credentialHash);
    if (!recovered.verified) return recovered;

    if (!identity) {
        return { verified: false, reason: 'Identity not found' };
    }

    if (!identity.isActive) {
        return { verified: false, reason: 'Identity is revoked' };
    }

    if (identity.owner.toLowerCase() !== recovered.prover.toLowerCase()) {
        return {
            verified: false,
            prover: recovered.prover,
            reason: 'Proof signer does not own the registered identity'
        };
    }

    return { verified: true, prover: recovered.prover };
}
