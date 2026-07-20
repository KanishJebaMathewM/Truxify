import { ethers } from 'ethers';
import axios from 'axios';
import logger from '../../api/src/middleware/logger.js';
import { supabase } from '../../api/src/config/db.js';

class MEVService {
    constructor() {
        this.provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        this.escrowAddress = process.env.MEV_ESCROW_ADDRESS;
        
        this.escrowABI = [
            'function createEscrow(address driver, bytes32 commitHash, bytes32 secretHash) external payable',
            'function releaseEscrowWithProof(uint256 escrowId, bytes32 secret, bytes calldata proof) external',
            'function disputeEscrowWithProof(uint256 escrowId, bytes calldata proof) external',
            'function createCommitment(bytes32 secretHash) external',
            'function revealCommitment(bytes32 secret) external',
            'function submitFlashbotsBundle(uint256 escrowId, bytes calldata bundleData) external',
            'function getMEVProtectionLevel(uint256 escrowId) external view returns (uint256)',
            'function getEscrow(uint256 escrowId) external view returns (tuple(address,address,uint256,bool,bool,uint256,uint256,bytes32,uint256,bool,bytes32))'
        ];

        this.escrow = new ethers.Contract(
            this.escrowAddress,
            this.escrowABI,
            this.wallet
        );

        // Flashbots endpoint
        this.flashbotsEndpoint = process.env.FLASHBOTS_ENDPOINT || 'https://relay.flashbots.net';
        
        logger.info('✅ MEV Protection Service initialized');
    }

    // ============ Commitment Creation ============

    async createCommitment(secret, userId) {
        try {
            // Hash secret with user address
            const secretHash = ethers.keccak256(
                ethers.toUtf8Bytes(secret + userId)
            );
            
            const tx = await this.escrow.createCommitment(secretHash, {
                gasLimit: 100000
            });
            const receipt = await tx.wait();
            
            // Store commitment
            await this.storeCommitment({
                userId,
                secretHash,
                txHash: receipt.hash
            });
            
            logger.info(`✅ Commitment created for user ${userId}`);
            return {
                success: true,
                secretHash,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Commitment creation failed:', error);
            throw error;
        }
    }

    // ============ MEV Protected Escrow ============

    async createEscrow(driver, amount, secret, userId) {
        try {
            // Create commitment first
            const commitment = await this.createCommitment(secret, userId);
            
            // Hash secret for escrow
            const secretHash = ethers.keccak256(
                ethers.toUtf8Bytes(secret + userId)
            );
            
            // Create escrow with commit hash
            const commitHash = ethers.keccak256(
                ethers.toUtf8Bytes(secret + userId + Date.now().toString())
            );
            
            const tx = await this.escrow.createEscrow(
                driver,
                commitHash,
                secretHash,
                { 
                    value: ethers.parseEther(amount.toString()),
                    gasLimit: 200000
                }
            );
            const receipt = await tx.wait();
            
            // Get escrow ID from logs
            const escrowId = await this.getEscrowCount();
            
            await this.storeEscrow({
                escrowId,
                customer: this.wallet.address,
                driver,
                amount,
                commitHash,
                secretHash,
                txHash: receipt.hash
            });
            
            logger.info(`✅ MEV Protected Escrow created: ${escrowId}`);
            return {
                success: true,
                escrowId,
                commitHash,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('MEV Escrow creation failed:', error);
            throw error;
        }
    }

    // ============ Release with MEV Protection ============

    async releaseEscrow(escrowId, secret, proof) {
        try {
            const tx = await this.escrow.releaseEscrowWithProof(
                escrowId,
                secret,
                proof,
                { gasLimit: 150000 }
            );
            const receipt = await tx.wait();
            
            await this.updateEscrowStatus(escrowId, 'released', receipt.hash);
            
            logger.info(`✅ Escrow ${escrowId} released with MEV protection`);
            return {
                success: true,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Escrow release failed:', error);
            throw error;
        }
    }

    // ============ Flashbots Integration ============

    async submitFlashbotsBundle(escrowId, transactions) {
        try {
            // Sign transactions
            const signedTxs = await this.signTransactions(transactions);
            
            // Get current block number
            const blockNumber = await this.provider.getBlockNumber();
            const targetBlock = blockNumber + 1;
            
            // Submit to Flashbots
            const response = await axios.post(
                `${this.flashbotsEndpoint}/eth/v1/bundle`,
                {
                    jsonrpc: "2.0",
                    method: "eth_sendBundle",
                    params: [{
                        txs: signedTxs,
                        blockNumber: `0x${targetBlock.toString(16)}`
                    }],
                    id: 1
                }
            );
            
            // Store bundle
            await this.storeBundle({
                escrowId,
                bundleId: response.data.result,
                blockNumber: targetBlock
            });
            
            logger.info(`✅ Flashbots bundle submitted for escrow ${escrowId}`);
            return {
                success: true,
                bundleId: response.data.result,
                blockNumber: targetBlock
            };
        } catch (error) {
            logger.error('Flashbots bundle submission failed:', error);
            throw error;
        }
    }

    async signTransactions(transactions) {
        const signedTxs = [];
        for (const tx of transactions) {
            const signedTx = await this.wallet.signTransaction(tx);
            signedTxs.push(signedTx);
        }
        return signedTxs;
    }

    // ============ MEV Protection Level ============

    async getMEVProtectionLevel(escrowId) {
        try {
            const level = await this.escrow.getMEVProtectionLevel(escrowId);
            return {
                escrowId,
                protectionLevel: level.toString(),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('MEV protection level fetch failed:', error);
            throw error;
        }
    }

    // ============ Helper Functions ============

    async getEscrowCount() {
        try {
            const count = await this.escrow.escrowCounter();
            return count.toString();
        } catch (error) {
            logger.error('Escrow count fetch failed:', error);
            return '0';
        }
    }

    async getEscrowDetails(escrowId) {
        try {
            const escrow = await this.escrow.getEscrow(escrowId);
            return {
                customer: escrow[0],
                driver: escrow[1],
                amount: ethers.formatEther(escrow[2]),
                released: escrow[3],
                disputed: escrow[4],
                createdAt: escrow[5].toString(),
                releasedAt: escrow[6].toString(),
                commitHash: escrow[7],
                revealDeadline: escrow[8].toString(),
                revealed: escrow[9],
                secret: escrow[10]
            };
        } catch (error) {
            logger.error('Escrow details fetch failed:', error);
            return null;
        }
    }

    // ============ Database Operations ============

    async storeCommitment(data) {
        const { error } = await supabase
            .from('mev_commitments')
            .insert([{
                user_id: data.userId,
                secret_hash: data.secretHash,
                tx_hash: data.txHash,
                created_at: new Date().toISOString()
            }]);
        if (error) throw error;
    }

    async storeEscrow(data) {
        const { error } = await supabase
            .from('mev_escrows')
            .insert([{
                escrow_id: data.escrowId,
                customer: data.customer,
                driver: data.driver,
                amount: data.amount,
                commit_hash: data.commitHash,
                secret_hash: data.secretHash,
                tx_hash: data.txHash,
                status: 'pending',
                created_at: new Date().toISOString()
            }]);
        if (error) throw error;
    }

    async updateEscrowStatus(escrowId, status, txHash) {
        const { error } = await supabase
            .from('mev_escrows')
            .update({
                status,
                released_tx_hash: txHash,
                released_at: new Date().toISOString()
            })
            .eq('escrow_id', escrowId);
        if (error) throw error;
    }

    async storeBundle(data) {
        const { error } = await supabase
            .from('flashbots_bundles')
            .insert([{
                escrow_id: data.escrowId,
                bundle_id: data.bundleId,
                block_number: data.blockNumber,
                submitted_at: new Date().toISOString()
            }]);
        if (error) throw error;
    }

    // ============ Statistics ============

    async getMEVStats() {
        const { data: escrows } = await supabase
            .from('mev_escrows')
            .select('*');
        
        const { data: bundles } = await supabase
            .from('flashbots_bundles')
            .select('*');

        return {
            totalEscrows: escrows?.length || 0,
            protectedEscrows: escrows?.filter(e => e.status === 'protected').length || 0,
            releasedEscrows: escrows?.filter(e => e.status === 'released').length || 0,
            totalBundles: bundles?.length || 0,
            timestamp: new Date().toISOString()
        };
    }
}

export default new MEVService();