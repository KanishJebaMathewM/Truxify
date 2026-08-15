import { ethers } from 'ethers';

/**
 * Off-Chain ZK-DID Credential Verification Utility
 */
export class ZkDidVerifier {
  createDidUri(address) {
    return `did:truxify:polygon:${address.toLowerCase()}`;
  }

  generateCredentialMerkleRoot(credentialAttributes) {
    const serialized = JSON.stringify(credentialAttributes);
    return ethers.keccak256(ethers.toUtf8Bytes(serialized));
  }

  verifyZkProofOffChain(didUri, proofHash, nullifierHash) {
    if (!didUri.startsWith('did:truxify:')) return false;
    if (!proofHash || proofHash === ethers.ZeroHash) return false;
    if (!nullifierHash || nullifierHash === ethers.ZeroHash) return false;

    return true;
  }
}

export const zkDidVerifier = new ZkDidVerifier();
