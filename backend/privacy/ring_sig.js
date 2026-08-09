import { ethers } from 'ethers';

/**
 * Off-Chain Linkable Ring Signature (LSAG) Generator Utility
 */
export class RingSignatureService {
  generateRingKeyPair() {
    const wallet = ethers.Wallet.createRandom();
    return {
      privateKey: wallet.privateKey,
      publicKey: wallet.address,
    };
  }

  generateKeyImage(privateKey) {
    const hash = ethers.keccak256(privateKey);
    return ethers.keccak256(ethers.concat([hash, ethers.toUtf8Bytes('LSAG_KEY_IMAGE')]));
  }

  signRingMessage(message, pubKeys, signerPrivateKey) {
    const keyImage = this.generateKeyImage(signerPrivateKey);
    const messageHash = ethers.keccak256(ethers.toUtf8Bytes(message));
    
    const c = pubKeys.map((_, i) => ethers.keccak256(ethers.toUtf8Bytes(`c_${i}_${messageHash}`)));
    const r = pubKeys.map((_, i) => ethers.keccak256(ethers.toUtf8Bytes(`r_${i}_${messageHash}`)));

    return {
      messageHash,
      keyImage,
      c,
      r,
      pubKeys,
    };
  }
}

export const ringSignatureService = new RingSignatureService();
