import { ethers } from 'ethers';
import crypto from 'crypto';
import logger from '../api/src/middleware/logger.js';
import { supabase } from '../api/src/config/db.js';
/**
 * Atomic Swap Service
 * 
 * Interacts with the deployed AtomicSwap.sol smart contract on the Polygon / EVM network.
 * Aligns ethers.js contract calls and ABI definitions with the actual contract specification.
 */
import { atomicSwapRelayer } from './swap_relayer.js';

import { ethers } from 'ethers';
import logger from '../middleware/logger.js';

// Correct ABI matching blockchain/contracts/AtomicSwap.sol
const ATOMIC_SWAP_ABI = [
  "function openSwap(bytes32 swapId, address payable recipient, bytes32 hashLock, uint256 lockDuration) external payable returns (bytes32)",
  "function claimSwap(bytes32 swapId, bytes calldata preimage) external",
  "function refundSwap(bytes32 swapId) external",
  "function getUserSwaps(address user) external view returns (bytes32[] memory)",
  "function swaps(bytes32) external view returns (bytes32 id, address payable initiator, address payable recipient, uint256 amount, bytes32 hashLock, uint256 lockDuration, uint256 expiresAt, bool withdrawn, bool refunded)",
  "function usedHashLocks(bytes32) external view returns (bool)",
  "event SwapOpened(bytes32 indexed swapId, address indexed initiator, address indexed recipient, uint256 amount, bytes32 hashLock, uint256 expiresAt)",
  "event SwapClaimed(bytes32 indexed swapId, bytes preimage)",
  "event SwapRefunded(bytes32 indexed swapId)"
];

export class SwapService {
  constructor(providerOrSigner, contractAddress) {
    if (!contractAddress) {
      throw new Error('AtomicSwap contract address is required.');
    }
    this.contractAddress = contractAddress;
    this.providerOrSigner = providerOrSigner;
    this.contract = new ethers.Contract(contractAddress, ATOMIC_SWAP_ABI, providerOrSigner);
  }

  /**
   * Opens a new hash time-locked swap (HTLC).
   * @param {string} swapId - Unique bytes32 identifier for the swap
   * @param {string} recipient - Recipient Ethereum address
   * @param {string} hashLock - SHA-256 / Keccak-256 hash lock (bytes32)
   * @param {number} lockDuration - Duration in seconds until expiration
   * @param {string|BigInt} amount - Amount of native token to lock (in wei)
   */
  async createSwap(swapId, recipient, hashLock, lockDuration, amount) {
    try {
      logger.info({ event: 'ATOMIC_SWAP_OPEN_INIT', swapId, recipient, amount }, 'Opening atomic swap on-chain');
      
      const tx = await this.contract.openSwap(
        swapId,
        recipient,
        hashLock,
        lockDuration,
        { value: amount }
      );

      const receipt = await tx.wait();
      logger.info({ event: 'ATOMIC_SWAP_OPEN_SUCCESS', swapId, txHash: receipt.transactionHash }, 'Atomic swap opened successfully');
      return { success: true, transactionHash: receipt.transactionHash, swapId };
    } catch (err) {
      logger.error({ event: 'ATOMIC_SWAP_OPEN_ERROR', swapId, error: err?.message }, 'Failed to open atomic swap');
      throw new Error(`Failed to create swap: ${err?.message}`);
    }
  }

  /**
   * Claims funds from an existing swap by revealing the preimage.
   * @param {string} swapId - Unique bytes32 identifier for the swap
   * @param {string|Uint8Array} preimage - Secret preimage matching the hashLock
   */
  async executeSwap(swapId, preimage) {
    try {
      logger.info({ event: 'ATOMIC_SWAP_CLAIM_INIT', swapId }, 'Claiming atomic swap on-chain');

      const tx = await this.contract.claimSwap(swapId, preimage);
      const receipt = await tx.wait();

      logger.info({ event: 'ATOMIC_SWAP_CLAIM_SUCCESS', swapId, txHash: receipt.transactionHash }, 'Atomic swap claimed successfully');
      return { success: true, transactionHash: receipt.transactionHash, swapId };
    } catch (err) {
      logger.error({ event: 'ATOMIC_SWAP_CLAIM_ERROR', swapId, error: err?.message }, 'Failed to claim atomic swap');
      throw new Error(`Failed to execute swap claim: ${err?.message}`);
    }
  }

  /**
   * Refunds a timed-out swap back to the initiator.
   * @param {string} swapId - Unique bytes32 identifier for the swap
   */
  async refundSwap(swapId) {
    try {
      logger.info({ event: 'ATOMIC_SWAP_REFUND_INIT', swapId }, 'Refunding atomic swap on-chain');

      const tx = await this.contract.refundSwap(swapId);
      const receipt = await tx.wait();

      logger.info({ event: 'ATOMIC_SWAP_REFUND_SUCCESS', swapId, txHash: receipt.transactionHash }, 'Atomic swap refunded successfully');
      return { success: true, transactionHash: receipt.transactionHash, swapId };
    } catch (err) {
      logger.error({ event: 'ATOMIC_SWAP_REFUND_ERROR', swapId, error: err?.message }, 'Failed to refund atomic swap');
      throw new Error(`Failed to refund swap: ${err?.message}`);
    }
  }

  /**
   * Retrieves swap details from the smart contract mapping.
   * @param {string} swapId - Unique bytes32 identifier for the swap
   */
  async getSwap(swapId) {
    try {
      const swap = await this.contract.swaps(swapId);
      if (!swap || swap.id === ethers.ZeroHash) {
        return null;
      }

      return {
        id: swap.id,
        initiator: swap.initiator,
        recipient: swap.recipient,
        amount: swap.amount.toString(),
        hashLock: swap.hashLock,
        lockDuration: Number(swap.lockDuration),
        expiresAt: Number(swap.expiresAt),
        withdrawn: swap.withdrawn,
        refunded: swap.refunded,
      };
    } catch (err) {
      logger.error({ event: 'ATOMIC_SWAP_GET_ERROR', swapId, error: err?.message }, 'Failed to retrieve swap details');
      return null;
    }
  }

  /**
   * Retrieves all swap IDs associated with a specific user address.
   * @param {string} userAddress - Ethereum address
   */
  async getUserSwaps(userAddress) {
    try {
      return await this.contract.getUserSwaps(userAddress);
    } catch (err) {
      logger.error({ event: 'ATOMIC_SWAP_USER_SWAPS_ERROR', userAddress, error: err?.message }, 'Failed to fetch user swaps');
      return [];
    }
  }

  /**
   * Checks if a hash lock has already been used.
   * @param {string} hashLock - bytes32 hash lock
   */
  async isHashLockUsed(hashLock) {
    try {
      return await this.contract.usedHashLocks(hashLock);
    } catch (err) {
      logger.error({ event: 'ATOMIC_SWAP_HASHLOCK_CHECK_ERROR', hashLock, error: err?.message }, 'Failed to check hash lock status');
      return false;
    }
  }
}

export default SwapService;
class AtomicSwapService {
    constructor() {
        const rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
        this.provider = new ethers.JsonRpcProvider(rpcUrl);

        const privateKey = process.env.PRIVATE_KEY && /^0x?[0-9a-fA-F]{64}$/.test(process.env.PRIVATE_KEY)
            ? process.env.PRIVATE_KEY
            : ethers.Wallet.createRandom().privateKey;

        this.wallet = new ethers.Wallet(privateKey, this.provider);

        this.swapAddress = (process.env.ATOMIC_SWAP_ADDRESS && ethers.isAddress(process.env.ATOMIC_SWAP_ADDRESS))
            ? process.env.ATOMIC_SWAP_ADDRESS
            : ethers.ZeroAddress;

        this.swapABI = [
            'function openSwap(bytes32 swapId, address payable recipient, bytes32 hashLock, uint256 lockDuration) external payable returns (bytes32)',
            'function claimSwap(bytes32 swapId, bytes preimage) external',
            'function refundSwap(bytes32 swapId) external',
            'function getUserSwaps(address user) external view returns (tuple(bytes32,bool)[])',
            'function swaps(bytes32 swapId) external view returns (address sender, address recipient, uint256 amount, bytes32 hashLock, uint256 lockTime, bool claimed, bool refunded, bool isCrossChain)',
            'function usedHashLocks(bytes32 hashLock) external view returns (bool)',
            'event SwapOpened(bytes32 indexed swapId, address indexed sender, address indexed recipient, uint256 amount, bytes32 hashLock, uint256 lockTime)',
            'event SwapClaimed(bytes32 indexed swapId, bytes preimage)',
            'event SwapRefunded(bytes32 indexed swapId)'
        ];

        this.lockDuration = 86400;

        this.swap = new ethers.Contract(this.swapAddress, this.swapABI, this.wallet);

        logger.info('✅ Atomic Swap Service initialized');
    }

    // ============ Hash Lock Generation ============

    generateSwapId() {
        return '0x' + crypto.randomBytes(32).toString('hex');
    }

    generateHashLock(secret, algorithm = 'keccak256') {
        return atomicSwapRelayer.hashPreimage(secret, algorithm);
    }

    generateSecret() {
        return '0x' + crypto.randomBytes(32).toString('hex');
    }

    // ============ Swap Operations ============

    async createSwap(counterparty, tokenAddress, amount, secret, initiator) {
        try {
            const validInitiator = atomicSwapRelayer.validateParticipantAddress(
                initiator,
                'Initiator'
            );

            const validCounterparty = atomicSwapRelayer.validateParticipantAddress(
                counterparty,
                'Counterparty'
            );

            // The initiator is the server-verified signer and must never
            // be the server wallet.
            if (
                this.wallet &&
                validInitiator.toLowerCase() === this.wallet.address.toLowerCase()
            ) {
                throw new Error(
                    'Invalid initiator: funding wallet must be user-owned'
                );
            }

            const amountValidation = atomicSwapRelayer.validateAmount(amount);

            if (!amountValidation.valid) {
                throw new Error(amountValidation.error);
            }

            // IMPORTANT:
            // Only the hash lock is persisted.
            // The plaintext secret must NOT be stored in the database
            // or returned from this service.
            const hashLock = this.generateHashLock(secret);

            if (await this.swap.usedHashLocks(hashLock)) {
                throw new Error('Hash lock already used');
            }

            const parsedAmount = ethers.parseEther(amount.toString());
            const swapId = this.generateSwapId();

            const token = tokenAddress || ethers.ZeroAddress;
            const value = token === ethers.ZeroAddress ? parsedAmount : 0;

            const tx = await this.swap.openSwap(
                swapId,
                validCounterparty,
                hashLock,
                this.lockDuration,
                {
                    value,
                    gasLimit: 300000
                }
            );

            const receipt = await tx.wait();

            await this.storeSwap({
                swapId,
                initiator: validInitiator,
                counterparty: validCounterparty,
                tokenAddress,
                amount,
                hashLock,
                txHash: receipt.hash
            });

            logger.info(`✅ Swap created: ${swapId}`);

            return {
                success: true,
                swapId: swapId.toString(),
                hashLock,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Swap creation failed:', error);
            throw error;
        }
    }

    async executeSwap(swapId, secret) {
        try {
            const tx = await this.swap.claimSwap(
                swapId,
                ethers.toUtf8Bytes(secret),
                {
                    gasLimit: 150000
                }
            );

            const receipt = await tx.wait();

            await this.updateSwapStatus(
                swapId,
                'executed',
                receipt.hash
            );

            logger.info(`✅ Swap executed: ${swapId}`);

            return {
                success: true,
                swapId,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Swap execution failed:', error);
            throw error;
        }
    }

    async refundSwap(swapId) {
        try {
            const tx = await this.swap.refundSwap(swapId, {
                gasLimit: 150000
            });

            const receipt = await tx.wait();

            await this.updateSwapStatus(
                swapId,
                'refunded',
                receipt.hash
            );

            logger.info(`✅ Swap refunded: ${swapId}`);

            return {
                success: true,
                swapId,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Swap refund failed:', error);
            throw error;
        }
    }

    // ============ Cross-Chain Swap Operations ============

    async createCrossChainSwap(
        destChainId,
        counterparty,
        tokenAddress,
        amount,
        secret,
        initiator
    ) {
        try {
            const validInitiator = atomicSwapRelayer.validateParticipantAddress(
                initiator,
                'Initiator'
            );

            const validCounterparty = atomicSwapRelayer.validateParticipantAddress(
                counterparty,
                'Counterparty'
            );

            if (
                this.wallet &&
                validInitiator.toLowerCase() === this.wallet.address.toLowerCase()
            ) {
                throw new Error(
                    'Invalid initiator: funding wallet must be user-owned'
                );
            }

            const amountValidation = atomicSwapRelayer.validateAmount(amount);

            if (!amountValidation.valid) {
                throw new Error(amountValidation.error);
            }

            // IMPORTANT:
            // Only the hash lock is persisted.
            // The plaintext secret must never be stored or returned.
            const hashLock = this.generateHashLock(secret);

            if (await this.swap.usedHashLocks(hashLock)) {
                throw new Error('Hash lock already used');
            }

            const parsedAmount = ethers.parseEther(amount.toString());

            const proof = ethers.keccak256(
                ethers.toUtf8Bytes(
                    `${destChainId}:${validCounterparty}:${tokenAddress}:${amount}`
                )
            );

            const swapId = this.generateSwapId();

            const token = tokenAddress || ethers.ZeroAddress;
            const value = token === ethers.ZeroAddress ? parsedAmount : 0;

            const tx = await this.swap.openSwap(
                swapId,
                validCounterparty,
                hashLock,
                this.lockDuration,
                {
                    value,
                    gasLimit: 350000
                }
            );

            const receipt = await tx.wait();

            await this.storeCrossChainSwap({
                swapId,
                sourceChainId: 137,
                destChainId,
                initiator: validInitiator,
                counterparty: validCounterparty,
                tokenAddress,
                amount,
                hashLock,
                proof,
                txHash: receipt.hash
            });

            logger.info(`✅ Cross-chain swap created: ${swapId}`);

            return {
                success: true,
                swapId: swapId.toString(),
                hashLock,
                proof,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error(
                'Cross-chain swap creation failed:',
                error
            );
            throw error;
        }
    }

    async executeCrossChainSwap(swapId, secret, proof) {
        try {
            const tx = await this.swap.claimSwap(
                swapId,
                ethers.toUtf8Bytes(secret),
                {
                    gasLimit: 200000
                }
            );

            const receipt = await tx.wait();

            await this.updateCrossChainSwapStatus(
                swapId,
                'executed',
                receipt.hash
            );

            logger.info(`✅ Cross-chain swap executed: ${swapId}`);

            return {
                success: true,
                swapId,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error(
                'Cross-chain swap execution failed:',
                error
            );
            throw error;
        }
    }

    async refundCrossChainSwap(swapId) {
        try {
            const tx = await this.swap.refundSwap(swapId, {
                gasLimit: 150000
            });

            const receipt = await tx.wait();

            await this.updateCrossChainSwapStatus(
                swapId,
                'refunded',
                receipt.hash
            );

            logger.info(`✅ Cross-chain swap refunded: ${swapId}`);

            return {
                success: true,
                swapId,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error(
                'Cross-chain swap refund failed:',
                error
            );
            throw error;
        }
    }

    // ============ View Functions ============

    async getSwap(swapId) {
        try {
            const swap = await this.swap.swaps(swapId);

            return {
                id: swapId,
                sender: swap[0],
                recipient: swap[1],
                amount: ethers.formatEther(swap[2]),
                hashLock: swap[3],
                lockTime: swap[4].toString(),
                claimed: swap[5],
                refunded: swap[6],
                isCrossChain: swap[7]
            };
        } catch (error) {
            logger.error('Swap fetch failed:', error);
            return null;
        }
    }

    async getCrossChainSwap(swapId) {
        try {
            const swap = await this.swap.swaps(swapId);

            return {
                id: swapId,
                sender: swap[0],
                recipient: swap[1],
                amount: ethers.formatEther(swap[2]),
                hashLock: swap[3],
                lockTime: swap[4].toString(),
                claimed: swap[5],
                refunded: swap[6],
                isCrossChain: swap[7]
            };
        } catch (error) {
            logger.error(
                'Cross-chain swap fetch failed:',
                error
            );
            return null;
        }
    }

    // ============ Database Operations ============

    async storeSwap(data) {
        const { error } = await supabase
            .from('atomic_swaps')
            .insert([{
                swap_id: data.swapId,
                initiator: data.initiator,
                counterparty: data.counterparty,
                token_address: data.tokenAddress,
                amount: data.amount,
                hash_lock: data.hashLock,
                tx_hash: data.txHash,
                status: 'pending',
                created_at: new Date().toISOString()
            }]);

        if (error) throw error;
    }

    async storeCrossChainSwap(data) {
        const { error } = await supabase
            .from('cross_chain_swaps')
            .insert([{
                swap_id: data.swapId,
                source_chain_id: data.sourceChainId,
                dest_chain_id: data.destChainId,
                initiator: data.initiator,
                counterparty: data.counterparty,
                token_address: data.tokenAddress,
                amount: data.amount,
                hash_lock: data.hashLock,
                proof: data.proof,
                tx_hash: data.txHash,
                status: 'pending',
                created_at: new Date().toISOString()
            }]);

        if (error) throw error;
    }

    async updateSwapStatus(swapId, status, txHash) {
        const { error } = await supabase
            .from('atomic_swaps')
            .update({
                status,
                executed_tx_hash: txHash,
                executed_at: new Date().toISOString()
            })
            .eq('swap_id', swapId);

        if (error) throw error;
    }

    async updateCrossChainSwapStatus(
        swapId,
        status,
        txHash
    ) {
        const { error } = await supabase
            .from('cross_chain_swaps')
            .update({
                status,
                executed_tx_hash: txHash,
                executed_at: new Date().toISOString()
            })
            .eq('swap_id', swapId);

        if (error) throw error;
    }

    // ============ Statistics ============

    async getSwapStats() {
        try {
            const { data: swaps } = await supabase
                .from('atomic_swaps')
                .select('*');

            const { data: crossSwaps } = await supabase
                .from('cross_chain_swaps')
                .select('*');

            return {
                totalSwaps: swaps?.length || 0,
                executedSwaps:
                    swaps?.filter(
                        s => s.status === 'executed'
                    ).length || 0,
                pendingSwaps:
                    swaps?.filter(
                        s => s.status === 'pending'
                    ).length || 0,
                refundedSwaps:
                    swaps?.filter(
                        s => s.status === 'refunded'
                    ).length || 0,
                totalCrossChainSwaps:
                    crossSwaps?.length || 0,
                totalVolume:
                    swaps?.reduce(
                        (sum, s) =>
                            sum + parseFloat(s.amount || 0),
                        0
                    ) || 0,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Stats fetch failed:', error);
            return null;
        }
    }
}

export default new AtomicSwapService();
