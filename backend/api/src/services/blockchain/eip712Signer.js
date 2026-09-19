import { ethers } from 'ethers';
import logger from '../../middleware/logger.js';

export const EIP712_ESCROW_TYPES = Object.freeze({
  ReleaseMilestoneMetaTx: [
    { name: 'bookingId', type: 'bytes32' },
    { name: 'milestoneId', type: 'uint8' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
});

export class Eip712Signer {
  /**
   * @param {object} [options={}]
   * @param {string} [options.verifyingContract] - Escrow contract address
   * @param {number} [options.chainId=137] - Polygon Mainnet (137) or Amoy (80002)
   */
  constructor(options = {}) {
    this.verifyingContract = options.verifyingContract || process.env.FREIGHT_ESCROW_CONTRACT_ADDRESS || ethers.ZeroAddress;
    this.chainId = options.chainId || parseInt(process.env.POLYGON_CHAIN_ID || '137', 10);
  }

  /**
   * Builds the EIP-712 Domain object.
   */
  getDomain() {
    return {
      name: 'TruxifyFreightEscrow',
      version: '1',
      chainId: this.chainId,
      verifyingContract: this.verifyingContract,
    };
  }

  /**
   * Builds typed data payload for milestone release meta-transactions.
   * 
   * @param {object} params
   * @param {string} params.bookingId - Hex string or UUID
   * @param {number} params.milestoneId - 1=Loading, 2=Transit, 3=Delivery
   * @param {bigint|string} params.amountWei - Amount in Wei (paisa converted)
   * @param {number} params.nonce - Current account nonce
   * @param {number} [params.deadlineSeconds=3600] - 1 hour validity
   * @returns {object} { domain, types, value }
   */
  buildReleaseMilestonePayload(params) {
    const {
      bookingId,
      milestoneId,
      amountWei,
      nonce,
      deadlineSeconds = 3600,
    } = params;

    const formattedBookingId = bookingId.startsWith('0x')
      ? bookingId
      : ethers.keccak256(ethers.toUtf8Bytes(bookingId));

    const deadline = Math.floor(Date.now() / 1000) + deadlineSeconds;

    return {
      domain: this.getDomain(),
      types: EIP712_ESCROW_TYPES,
      value: {
        bookingId: formattedBookingId,
        milestoneId: Number(milestoneId),
        amount: BigInt(amountWei).toString(),
        nonce: Number(nonce),
        deadline,
      },
    };
  }

  /**
   * Recovers the signing address from an EIP-712 signature.
   * 
   * @param {object} typedPayload - { domain, types, value }
   * @param {string} signature - Hex ECDSA signature
   * @returns {string} Checksummed Ethereum signer address
   */
  verifySigner(typedPayload, signature) {
    try {
      const recovered = ethers.verifyTypedData(
        typedPayload.domain,
        typedPayload.types,
        typedPayload.value,
        signature
      );
      return ethers.getAddress(recovered);
    } catch (err) {
      logger.error({ err }, '[Eip712Signer] Failed recovering EIP-712 signer');
      throw new Error(`Invalid EIP-712 signature: ${err.message}`);
    }
  }
}

export default Eip712Signer;
