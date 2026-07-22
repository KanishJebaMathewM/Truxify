import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import logger from '../../api/src/middleware/logger.js';
import { supabase } from '../../api/src/config/db.js';

class AtomicSwapService {
    constructor() {
        this.provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        this.swapAddress = process.env.ATOMIC_SWAP_ADDRESS;

        this.swapABI = [
            'function createSwap(address counterparty, address tokenAddress, uint256 amount, bytes32 hashLock) external payable returns (uint256)',
            'function executeSwap(uint256 swapId, bytes32 secret) external',
            'function refundSwap(uint256 swapId) external',
            'function createCrossChainSwap(uint256 destChainId, address counterparty, address tokenAddress, uint256 amount, bytes32 hashLock, bytes32 proof) external payable returns (uint256)',
            'function executeCrossChainSwap(uint256 swapId, bytes32 secret, bytes32 proof) external',
            'function refundCrossChainSwap(uint256 swapId) external',
            'function getSwap(uint256 swapId) external view returns (tuple(uint256,address,address,address,uint256,bytes32,uint256,bool,bool,uint256,bytes32))',
            'function getCrossChainSwap(uint256 swapId) external view returns (tuple(uint256,uint256,uint256,address,address,address,uint256,bytes32,uint256,bool,bool,bytes32,bytes32))',
            'function isHashLockUsed(bytes32 hashLock) external view returns (bool)'
        ];

        this.swap = new ethers.Contract(this.swapAddress, this.swapABI, this.wallet);

        logger.info('✅ Atomic Swap Service initialized');
    }

    // ============ Hash Lock Generation ============

    generateHashLock(secret) {
        return ethers.keccak256(ethers.toUtf8Bytes(secret));
    }

    generateSecret() {
        return crypto.randomBytes(32).toString('hex');
    }

    // ============ Swap Operations ============

    async createSwap(counterparty, tokenAddress, amount, secret) {
        try {
            const hashLock = this.generateHashLock(secret);
            const parsedAmount = ethers.parseEther(amount.toString());

            const tx = await this.swap.createSwap(
                counterparty,
                tokenAddress || ethers.ZeroAddress,
                parsedAmount,
                hashLock,
                {
                    value: tokenAddress === ethers.ZeroAddress ? parsedAmount : 0,
                    gasLimit: 300000
                }
            );
            const receipt = await tx.wait();

            const swapId = await this.swap.getSwapCount();

            await this.storeSwap({
                swapId,
                initiator: this.wallet.address,
                counterparty,
                tokenAddress,
                amount,
                hashLock,
                secret,
                txHash: receipt.hash
            });

            logger.info(`✅ Swap created: ${swapId}`);
            return {
                success: true,
                swapId: swapId.toString(),
                hashLock,
                secret,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Swap creation failed:', error);
            throw error;
        }
    }

    async executeSwap(swapId, secret) {
        try {
            const hashLock = this.generateHashLock(secret);
            const tx = await this.swap.executeSwap(swapId, hashLock, {
                gasLimit: 150000
            });
            const receipt = await tx.wait();

            await this.updateSwapStatus(swapId, 'executed', receipt.hash);

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

            await this.updateSwapStatus(swapId, 'refunded', receipt.hash);

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

    async createCrossChainSwap(destChainId, counterparty, tokenAddress, amount, secret) {
        try {
            const hashLock = this.generateHashLock(secret);
            const parsedAmount = ethers.parseEther(amount.toString());
            const proof = ethers.keccak256(ethers.toUtf8Bytes(`${destChainId}:${counterparty}:${Date.now()}`));

            const tx = await this.swap.createCrossChainSwap(
                destChainId,
                counterparty,
                tokenAddress || ethers.ZeroAddress,
                parsedAmount,
                hashLock,
                proof,
                {
                    value: tokenAddress === ethers.ZeroAddress ? parsedAmount : 0,
                    gasLimit: 350000
                }
            );
            const receipt = await tx.wait();

            const swapId = await this.swap.getCrossChainSwapCount();

            await this.storeCrossChainSwap({
                swapId,
                sourceChainId: 137, // Polygon
                destChainId,
                initiator: this.wallet.address,
                counterparty,
                tokenAddress,
                amount,
                hashLock,
                secret,
                proof,
                txHash: receipt.hash
            });

            logger.info(`✅ Cross-chain swap created: ${swapId}`);
            return {
                success: true,
                swapId: swapId.toString(),
                hashLock,
                secret,
                proof,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Cross-chain swap creation failed:', error);
            throw error;
        }
    }

    async executeCrossChainSwap(swapId, secret, proof) {
        try {
            const hashLock = this.generateHashLock(secret);
            const tx = await this.swap.executeCrossChainSwap(swapId, hashLock, proof, {
                gasLimit: 200000
            });
            const receipt = await tx.wait();

            await this.updateCrossChainSwapStatus(swapId, 'executed', receipt.hash);

            logger.info(`✅ Cross-chain swap executed: ${swapId}`);
            return {
                success: true,
                swapId,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Cross-chain swap execution failed:', error);
            throw error;
        }
    }

    async refundCrossChainSwap(swapId) {
        try {
            const tx = await this.swap.refundCrossChainSwap(swapId, {
                gasLimit: 150000
            });
            const receipt = await tx.wait();

            await this.updateCrossChainSwapStatus(swapId, 'refunded', receipt.hash);

            logger.info(`✅ Cross-chain swap refunded: ${swapId}`);
            return {
                success: true,
                swapId,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Cross-chain swap refund failed:', error);
            throw error;
        }
    }

    // ============ View Functions ============

    async getSwap(swapId) {
        try {
            const swap = await this.swap.getSwap(swapId);
            return {
                id: swap[0].toString(),
                initiator: swap[1],
                counterparty: swap[2],
                tokenAddress: swap[3],
                amount: ethers.formatEther(swap[4]),
                hashLock: swap[5],
                timelock: swap[6].toString(),
                executed: swap[7],
                refunded: swap[8],
                createdAt: swap[9].toString(),
                secret: swap[10]
            };
        } catch (error) {
            logger.error('Swap fetch failed:', error);
            return null;
        }
    }

    async getCrossChainSwap(swapId) {
        try {
            const swap = await this.swap.getCrossChainSwap(swapId);
            return {
                id: swap[0].toString(),
                sourceChainId: swap[1].toString(),
                destChainId: swap[2].toString(),
                initiator: swap[3],
                counterparty: swap[4],
                tokenAddress: swap[5],
                amount: ethers.formatEther(swap[6]),
                hashLock: swap[7],
                timelock: swap[8].toString(),
                executed: swap[9],
                refunded: swap[10],
                secret: swap[11],
                proof: swap[12]
            };
        } catch (error) {
            logger.error('Cross-chain swap fetch failed:', error);
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
                secret: data.secret,
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
                secret: data.secret,
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

    async updateCrossChainSwapStatus(swapId, status, txHash) {
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
                executedSwaps: swaps?.filter(s => s.status === 'executed').length || 0,
                pendingSwaps: swaps?.filter(s => s.status === 'pending').length || 0,
                refundedSwaps: swaps?.filter(s => s.status === 'refunded').length || 0,
                totalCrossChainSwaps: crossSwaps?.length || 0,
                totalVolume: swaps?.reduce((sum, s) => sum + parseFloat(s.amount || 0), 0) || 0,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Stats fetch failed:', error);
            return null;
        }
    }
}

export default new AtomicSwapService();