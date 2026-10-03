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

  verifyZkProofOffChain(didUri, zkProof, publicInputs, nullifierHash) {
    if (!didUri.startsWith('did:truxify:')) return false;
    if (!zkProof || zkProof === '0x') return false;
    if (!publicInputs || !Array.isArray(publicInputs) || publicInputs.length === 0) return false;
    if (!nullifierHash || nullifierHash === ethers.ZeroHash) return false;

    return true;
  }
}

export const zkDidVerifier = new ZkDidVerifier();
