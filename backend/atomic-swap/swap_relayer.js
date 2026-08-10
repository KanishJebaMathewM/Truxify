import { ethers } from 'ethers';

/**
 * Cross-Chain HTLC Atomic Swap Listener & Secret Revelation Relayer
 */
export class AtomicSwapRelayer {
  generateHashLockSecret() {
    const secretBytes = ethers.randomBytes(32);
    const secretHex = ethers.hexlify(secretBytes);
    const hashLock = ethers.keccak256(secretBytes);
    return {
      secretHex,
      hashLock,
    };
  }

  verifyPreimage(secretHex, expectedHashLock) {
    const computedHash = ethers.keccak256(secretHex);
    return computedHash.toLowerCase() === expectedHashLock.toLowerCase();
  }
}

export const atomicSwapRelayer = new AtomicSwapRelayer();
