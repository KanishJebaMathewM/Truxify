import { ethers } from 'ethers';

/**
 * ZK Rating Proof & Nullifier Utility
 */
export class ZkRatingProofService {
  generateNullifier(tripSecret, customerId) {
    const raw = `${tripSecret}:${customerId}`;
    return ethers.keccak256(ethers.toUtf8Bytes(raw));
  }

  generateZkProof(driverAddress, ratingStars, nullifierHash) {
    const payload = `${driverAddress}:${ratingStars}:${nullifierHash}`;
    const zkProof = ethers.keccak256(ethers.toUtf8Bytes(payload));
    return {
      driverAddress,
      ratingStars,
      nullifierHash,
      zkProof,
    };
  }
}

export const zkRatingService = new ZkRatingProofService();
