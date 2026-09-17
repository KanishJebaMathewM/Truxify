import { ethers } from 'ethers';
import crypto from 'crypto';
import { supabase } from '../api/src/config/db.js';

export const ZKID_CHALLENGE_DOMAIN = 'TRUXIFY_ZKID_VERIFICATION_V1';
export const ZKID_CHALLENGE_TTL_SECONDS = 5 * 60;

function assertBytes32(value, name) {
    if (!ethers.isHexString(value, 32)) {
        throw new Error(`${name} must be a bytes32 value`);
    }
}

function assertPositiveSafeInteger(value, name) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new Error(`${name} must be a positive safe integer`);
    }
    return number;
}

export function buildVerificationChallenge({
    identityHash,
    credentialHash,
    nonce,
    issuedAt,
    expiresAt,
    chainId,
    contractAddress
}) {
    assertBytes32(identityHash, 'identityHash');
    assertBytes32(credentialHash, 'credentialHash');
    assertBytes32(nonce, 'nonce');

    const start = assertPositiveSafeInteger(issuedAt, 'issuedAt');
    const end = assertPositiveSafeInteger(expiresAt, 'expiresAt');
    const id = assertPositiveSafeInteger(chainId, 'chainId');

    if (end <= start) throw new Error('Challenge expiry must be after issuance');
    if (!ethers.isAddress(contractAddress)) throw new Error('contractAddress must be a valid address');

    return ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ['string', 'uint256', 'address', 'bytes32', 'bytes32', 'bytes32', 'uint256', 'uint256'],
            [ZKID_CHALLENGE_DOMAIN, id, contractAddress, identityHash, credentialHash, nonce, start, end]
        )
    );
}

export async function getZkidChainId(provider) {
    const configuredChainId = process.env.ZKID_CHAIN_ID || process.env.POLYGON_CHAIN_ID;
    if (configuredChainId) return assertPositiveSafeInteger(configuredChainId, 'ZKID_CHAIN_ID');

    const network = await provider.getNetwork();
    return assertPositiveSafeInteger(network.chainId, 'chainId');
}

export async function createVerificationChallenge({ provider, zkidAddress, identityHash, credentialHash }) {
    assertBytes32(identityHash, 'identityHash');
    assertBytes32(credentialHash, 'credentialHash');
    if (!ethers.isAddress(zkidAddress)) throw new Error('ZKID_CONTRACT_ADDRESS is not configured with a valid address');

    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + ZKID_CHALLENGE_TTL_SECONDS;
    const nonce = ethers.hexlify(crypto.randomBytes(32));
    const chainId = await getZkidChainId(provider);
    const challenge = buildVerificationChallenge({
        identityHash,
        credentialHash,
        nonce,
        issuedAt,
        expiresAt,
        chainId,
        contractAddress: zkidAddress
    });

    const { error } = await supabase
        .from('zkid_verification_challenges')
        .insert([{
            nonce,
            identity_hash: identityHash,
            credential_hash: credentialHash,
            chain_id: chainId,
            contract_address: zkidAddress.toLowerCase(),
            issued_at: new Date(issuedAt * 1000).toISOString(),
            expires_at: new Date(expiresAt * 1000).toISOString()
        }]);
    if (error) throw error;

    return {
        domain: ZKID_CHALLENGE_DOMAIN,
        chainId,
        contractAddress: zkidAddress,
        identityHash,
        credentialHash,
        nonce,
        issuedAt,
        expiresAt,
        challenge
    };
}

export async function validateVerificationChallenge({
    challengeData,
    identityHash,
    credentialHash,
    zkidAddress,
    expectedChainId,
    now = Math.floor(Date.now() / 1000)
}) {
    if (!challengeData || typeof challengeData !== 'object') return { valid: false, reason: 'Verification challenge is required' };
    if (challengeData.domain !== ZKID_CHALLENGE_DOMAIN) return { valid: false, reason: 'Invalid verification challenge domain' };
    if (String(challengeData.identityHash || '').toLowerCase() !== String(identityHash || '').toLowerCase()) return { valid: false, reason: 'Challenge identity does not match request' };
    if (String(challengeData.credentialHash || '').toLowerCase() !== String(credentialHash || '').toLowerCase()) return { valid: false, reason: 'Challenge credential does not match request' };
    if (!ethers.isAddress(challengeData.contractAddress)) return { valid: false, reason: 'Invalid verification contract address' };
    if (challengeData.contractAddress.toLowerCase() !== zkidAddress.toLowerCase()) return { valid: false, reason: 'Challenge contract does not match verifier' };
    if (!ethers.isHexString(challengeData.nonce, 32)) return { valid: false, reason: 'Invalid verification nonce' };

    const chainId = Number(challengeData.chainId);
    const issuedAt = Number(challengeData.issuedAt);
    const expiresAt = Number(challengeData.expiresAt);
    if (!Number.isSafeInteger(chainId) || chainId <= 0 || !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) {
        return { valid: false, reason: 'Invalid verification challenge timestamps' };
    }
    if (chainId !== Number(expectedChainId)) return { valid: false, reason: 'Challenge chain does not match verifier' };
    if (expiresAt <= issuedAt || expiresAt - issuedAt > ZKID_CHALLENGE_TTL_SECONDS) return { valid: false, reason: 'Invalid verification challenge lifetime' };
    if (issuedAt > now + 30) return { valid: false, reason: 'Verification challenge is not yet valid' };
    if (expiresAt <= now) return { valid: false, reason: 'Verification challenge has expired' };

    let expectedChallenge;
    try {
        expectedChallenge = buildVerificationChallenge({
            identityHash,
            credentialHash,
            nonce: challengeData.nonce,
            issuedAt,
            expiresAt,
            chainId,
            contractAddress: challengeData.contractAddress
        });
    } catch {
        return { valid: false, reason: 'Invalid verification challenge' };
    }

    if (expectedChallenge.toLowerCase() !== String(challengeData.challenge || '').toLowerCase()) {
        return { valid: false, reason: 'Verification challenge digest mismatch' };
    }

    return { valid: true, chainId, issuedAt, expiresAt };
}

export function recoverChallengeSigner(proofData, challenge) {
    if (!proofData || !ethers.isHexString(proofData) || proofData === ethers.ZeroHash) {
        return { verified: false, reason: 'Missing or invalid proofData' };
    }

    try {
        return {
            verified: true,
            prover: ethers.verifyMessage(ethers.getBytes(challenge), proofData)
        };
    } catch {
        return { verified: false, reason: 'Proof signature recovery failed' };
    }
}

export async function consumeVerificationChallenge({ nonce, identityHash, credentialHash, chainId }) {
    const { data, error } = await supabase
        .from('zkid_verification_challenges')
        .update({ used_at: new Date().toISOString() })
        .eq('nonce', nonce)
        .eq('identity_hash', identityHash)
        .eq('credential_hash', credentialHash)
        .eq('chain_id', chainId)
        .is('used_at', null)
        .select('nonce')
        .maybeSingle();

    if (error) throw error;
    return !!data;
}
