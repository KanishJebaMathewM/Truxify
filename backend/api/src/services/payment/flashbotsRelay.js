import { ethers } from 'ethers';
import axios from 'axios';
import crypto from 'crypto';
import logger from '../../middleware/logger.js';

class FlashbotsRelayService {
  constructor(signer, relayUrl = 'https://relay.flashbots.net') {
    this.signer = signer || (process.env.PRIVATE_KEY ? new ethers.Wallet(process.env.PRIVATE_KEY) : null);
    this.relayUrl = relayUrl;
  }

  async submitBundle(bundlePayload) {
    try {
      if (!this.signer) {
        throw new Error('Flashbots signer wallet is not initialized.');
      }

      // Serialize the payload to exact raw JSON bytes
      const rawBody = JSON.stringify(bundlePayload);
      
      // Flashbots requires the signature over the exact serialized JSON bytes
      const messageHash = ethers.keccak256(ethers.toUtf8Bytes(rawBody));
      const signature = await this.signer.signMessage(ethers.getBytes(messageHash));
      const authHeader = `${this.signer.address}:${signature}`;

      const response = await axios.post(this.relayUrl, rawBody, {
        headers: {
          'Content-Type': 'application/json',
          'X-Flashbots-Signature': authHeader,
        },
        timeout: 15000,
      });

      logger.info({ event: 'FLASHBOTS_BUNDLE_SUBMITTED', txCount: bundlePayload?.txs?.length }, '[Flashbots] Bundle submitted successfully.');

      return {
        success: true,
        bundleHash: response.data?.result || response.data?.bundleHash || crypto.randomUUID(),
        response: response.data,
      };
    } catch (err) {
      logger.error({ err: err?.message, event: 'FLASHBOTS_SUBMISSION_FAILED' }, '[Flashbots] Bundle submission failed.');
      throw new Error(`Flashbots relay error: ${err?.message ?? String(err)}`, { cause: err });
    }
  }
}

export const flashbotsRelay = new FlashbotsRelayService();
export default FlashbotsRelayService;
