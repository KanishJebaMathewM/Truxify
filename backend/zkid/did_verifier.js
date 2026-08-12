import crypto from 'node:crypto';
import { ethers } from 'ethers';

/**
 * Off-Chain ZK-DID Credential Verification Utility
 */
const VERIFYING_KEY = Buffer.from(
  'truxify.zkid.offchain.v1.verifying.key.0123456789abcdef',
  'utf8'
);

/**
 * Keyed commitment used as the stand-in for a real zk-SNARK verifier.
 * The proof and nullifier are only accepted when they are exactly the
 * HMAC-SHA256 keyed commitment of the statement under the shared verifying
 * key, so a caller cannot pass arbitrary non-zero hashes.
 */
function keyedCommitment(statement) {
  const hmac = crypto
    .createHmac('sha256', VERIFYING_KEY)
    .update(statement, 'utf8')
    .digest('hex');
  return `0x${hmac}`;
}

function isWellFormedHash(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export class ZkDidVerifier {
  createDidUri(address) {
    return `did:truxify:polygon:${address.toLowerCase()}`;
  }

  generateCredentialMerkleRoot(credentialAttributes) {
    const serialized = JSON.stringify(credentialAttributes);
    return ethers.keccak256(ethers.toUtf8Bytes(serialized));
  }

  /**
   * The nullifier must be the keyed commitment of the DID, so a caller cannot
   * pick an arbitrary nullifier for the credential.
   */
  generateNullifierHash(didUri) {
    return keyedCommitment(`${didUri}\u0000nullifier`);
  }

  /**
   * The proof must be the keyed commitment of the statement (didUri +
   * nullifierHash), so a caller cannot fabricate a proof for other inputs.
   */
  generateProofHash(didUri, nullifierHash) {
    return keyedCommitment(`${didUri}\u0000${nullifierHash}`);
  }

  verifyZkProofOffChain(didUri, proofHash, nullifierHash) {
    if (!didUri || !didUri.startsWith('did:truxify:')) return false;
    if (!isWellFormedHash(proofHash) || !isWellFormedHash(nullifierHash)) return false;
    if (proofHash === ethers.ZeroHash || nullifierHash === ethers.ZeroHash) return false;

    // The nullifier must be the keyed commitment of the DID.
    const expectedNullifier = this.generateNullifierHash(didUri);
    if (nullifierHash.toLowerCase() !== expectedNullifier) return false;

    // The proof must be the keyed commitment of the statement it claims.
    const expectedProof = this.generateProofHash(didUri, nullifierHash);
    if (proofHash.toLowerCase() !== expectedProof) return false;

    return true;
  }
}

export const zkDidVerifier = new ZkDidVerifier();
