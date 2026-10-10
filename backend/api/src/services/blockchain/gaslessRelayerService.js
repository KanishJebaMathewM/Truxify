import { ethers } from 'ethers';
import logger from '../../middleware/logger.js';
import { acquireDistributedLock } from '../../lib/redisLock.js';

export class GaslessRelayerService {
  /**
   * @param {object} [options={}]
   * @param {string} [options.rpcUrl]
   * @param {string} [options.relayerPrivateKey]
   * @param {string} [options.contractAddress]
   */
  constructor(options = {}) {
    this.rpcUrl = options.rpcUrl || process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
    this.privateKey = options.relayerPrivateKey || process.env.RELAYER_WALLET_PRIVATE_KEY || '';
    this.contractAddress = options.contractAddress || process.env.FREIGHT_ESCROW_CONTRACT_ADDRESS || '';

    this.provider = new ethers.JsonRpcProvider(this.rpcUrl);
    this.wallet = this.privateKey ? new ethers.Wallet(this.privateKey, this.provider) : null;
    this.dlq = [];
  }

  /**
   * Estimates dynamic EIP-1559 gas fees for Polygon network.
   * @returns {Promise<{maxFeePerGas: bigint, maxPriorityFeePerGas: bigint}>}
   */
  async estimateGasFees() {
    const feeData = await this.provider.getFeeData();
    const minPriority = ethers.parseUnits('30', 'gwei'); // Minimum Polygon priority fee
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas
      ? (feeData.maxPriorityFeePerGas > minPriority ? feeData.maxPriorityFeePerGas : minPriority)
      : minPriority;

    const baseFee = feeData.gasPrice || ethers.parseUnits('50', 'gwei');
    const maxFeePerGas = (baseFee * 120n) / 100n + maxPriorityFeePerGas; // 20% buffer over baseFee

    return { maxFeePerGas, maxPriorityFeePerGas };
  }

  /**
   * Submits a gasless milestone release meta-transaction on-chain with atomic nonce locking.
   * 
   * @param {object} params
   * @param {string} params.bookingId
   * @param {number} params.milestoneId
   * @param {string|bigint} params.amount
   * @param {number} params.nonce
   * @param {number} params.deadline
   * @param {string} params.signature
   * @returns {Promise<{success: boolean, transactionHash: string, blockNumber: number}>}
   */
  async relayMilestoneRelease(params) {
    if (!this.wallet || !this.contractAddress) {
      throw new Error('Relayer wallet or FreightEscrow contract address not configured');
    }

    const {
      bookingId,
      milestoneId,
      amount,
      nonce,
      deadline,
      signature,
    } = params;

    const lockKey = 'lock:relayer:nonce';
    const lock = await acquireDistributedLock(lockKey, 15);

    if (!lock.acquired) {
      throw new Error('Relayer nonce lock is busy, please retry in a moment');
    }

    try {
      const contractAbi = [
        'function releaseMilestoneMetaTx(bytes32 bookingId, uint8 milestoneId, uint256 amount, uint256 nonce, uint256 deadline, bytes calldata signature) external',
      ];

      const contract = new ethers.Contract(this.contractAddress, contractAbi, this.wallet);
      const gasFees = await this.estimateGasFees();
      const currentRelayerNonce = await this.provider.getTransactionCount(this.wallet.address, 'pending');

      const formattedBookingId = bookingId.startsWith('0x')
        ? bookingId
        : ethers.keccak256(ethers.toUtf8Bytes(bookingId));

      logger.info(
        { bookingId, milestoneId, relayerNonce: currentRelayerNonce },
        '[GaslessRelayerService] Broadcasting EIP-712 meta-transaction to Polygon'
      );

      // Submit transaction
      let tx = await contract.releaseMilestoneMetaTx(
        formattedBookingId,
        milestoneId,
        amount,
        nonce,
        deadline,
        signature,
        {
          nonce: currentRelayerNonce,
          maxFeePerGas: gasFees.maxFeePerGas,
          maxPriorityFeePerGas: gasFees.maxPriorityFeePerGas,
          gasLimit: 300000,
        }
      );

      // Wait with 30s timeout; if unmined, perform speed-up (+15% gas bumping)
      const receipt = await this._waitForTransactionOrSpeedUp(tx, contract, formattedBookingId, params, currentRelayerNonce);

      return {
        success: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
      };
    } catch (err) {
      logger.error({ err, bookingId }, '[GaslessRelayerService] Meta-transaction broadcast failed');
      this.dlq.push({ params, error: err.message, failedAt: new Date().toISOString() });
      throw err;
    } finally {
      await lock.release();
    }
  }

  /**
   * Waits for transaction confirmation or speeds up with 15% gas price bump if stalled in mempool.
   * @private
   */
  async _waitForTransactionOrSpeedUp(tx, contract, bookingId, params, relayerNonce) {
    try {
      // Wait up to 30 seconds for initial confirmation
      return await this.provider.waitForTransaction(tx.hash, 1, 30000);
    } catch (err) {
      if (err.code === 'TIMEOUT') {
        logger.warn({ txHash: tx.hash }, '[GaslessRelayerService] Transaction stalled in mempool; bumping gas +15%');
        
        const bumpedFees = await this.estimateGasFees();
        const bumpedMaxFee = (bumpedFees.maxFeePerGas * 115n) / 100n;
        const bumpedPriority = (bumpedFees.maxPriorityFeePerGas * 115n) / 100n;

        const replacementTx = await contract.releaseMilestoneMetaTx(
          bookingId,
          params.milestoneId,
          params.amount,
          params.nonce,
          params.deadline,
          params.signature,
          {
            nonce: relayerNonce,
            maxFeePerGas: bumpedMaxFee,
            maxPriorityFeePerGas: bumpedPriority,
            gasLimit: 300000,
          }
        );

        logger.info({ replacementTxHash: replacementTx.hash }, '[GaslessRelayerService] Broadcasted replacement transaction');
        return await replacementTx.wait(1);
      }
      throw err;
    }
  }
}

export default GaslessRelayerService;
