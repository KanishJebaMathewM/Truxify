import { ethers } from 'ethers';
import axios from 'axios';
import logger from '../api/src/middleware/logger.js';
import { supabase } from '../api/src/config/db.js';

/**
 * Derives the exact 32-byte preimage that is revealed on-chain.
 *
 * releaseDepositPrivate re-hashes the revealed bytes32 as
 * `keccak256(abi.encodePacked(bytes32))`, so the secretHash committed via
 * createProtectedDeposit must be `keccak256(preimage)` for exactly those 32
 * bytes. Hashing the caller-supplied secret down to a fixed 32-byte value keeps
 * creation and release consistent for secrets of any length/content (a plain
 * string passed straight into the bytes32 slot would be zero-padded on-chain,
 * producing a digest that can never match the commitment).
 */
export function toPreimageBytes32(secret) {
    if (typeof secret === 'string' && secret.startsWith('0x') && secret.length === 66) {
        return secret;
    }
    return ethers.keccak256(ethers.toUtf8Bytes(String(secret)));
}

class MEVService {
    constructor() {
        this.provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        this.escrowAddress = process.env.MEV_ESCROW_ADDRESS;
        
        this.escrowABI = [
            'function createProtectedDeposit(address payable driver, bytes32 secretHash) external payable returns (uint256)',
            'function releaseDepositPrivate(uint256 depositId, bytes32 preimage) external',
            'function refundDeposit(uint256 depositId) external',
            'function depositCount() external view returns (uint256)',
            'function deposits(uint256 depositId) external view returns (address shipper, address driver, uint256 amount, bool released, uint256 blockMin, bytes32 secretHash)',
            'event DepositCreated(uint256 indexed depositId, address indexed shipper, address indexed driver, uint256 amount)',
            'event DepositReleasedMEV(uint256 indexed depositId, address indexed driver, uint256 amount)',
            'event DepositRefunded(uint256 indexed depositId, address indexed shipper, uint256 amount)'
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
            // Hash the fixed 32-byte preimage revealed at release time, so the
            // on-chain keccak256(abi.encodePacked(preimage)) == secretHash check
            // can pass.
            const preimage = toPreimageBytes32(secret);
            const secretHash = ethers.keccak256(preimage);
            
            // Store commitment. The contract does not expose a commitment
            // function; the secretHash is embedded in the deposit via
            // createProtectedDeposit.
            await this.storeCommitment({
                userId,
                secretHash,
                txHash: null
            });
            
            logger.info(`✅ Commitment created for user ${userId}`);
            return {
                success: true,
                secretHash,
                txHash: null
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
            
            // Same preimage bytes the release reveals; must match the digest
            // committed on-chain by createProtectedDeposit.
            const secretHash = ethers.keccak256(toPreimageBytes32(secret));
            
            // Create MEV-protected deposit. The contract exposes
            // createProtectedDeposit(address payable driver, bytes32 secretHash);
            // the secretHash is stored on-chain as the deposit's commit hash.
            const tx = await this.escrow.createProtectedDeposit(
                driver,
                secretHash,
                { 
                    value: ethers.parseEther(amount.toString()),
                    gasLimit: 200000
                }
            );
            const receipt = await tx.wait();
            
            // Get real deposit ID from the emitted DepositCreated event
            const escrowId = this._parseDepositCreated(receipt);
            
            await this.storeEscrow({
                escrowId,
                customer: this.wallet.address,
                driver,
                amount,
                commitHash: secretHash,
                secretHash,
                txHash: receipt.hash
            });
            
            logger.info(`✅ MEV Protected Escrow created: ${escrowId}`);
            return {
                success: true,
                escrowId,
                commitHash: secretHash,
                secretHash,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('MEV Escrow creation failed:', error);
            throw error;
        }
    }

    _parseDepositCreated(receipt) {
        for (const log of receipt.logs) {
            try {
                const parsed = this.escrow.interface.parseLog(log);
                if (parsed && parsed.name === 'DepositCreated') {
                    return parsed.args.depositId.toString();
                }
            } catch (e) {
                continue;
            }
        }
        throw new Error('DepositCreated event not found in receipt');
    }

    // ============ Release with MEV Protection ============

    async releaseEscrow(escrowId, secret) {
        try {
            // Reveal the same 32-byte preimage the commitment was created from.
            // Passing the raw string into the bytes32 slot zero-pads it on-chain
            // and the digest would never match the committed secretHash.
            const preimage = toPreimageBytes32(secret);
            const tx = await this.escrow.releaseDepositPrivate(
                escrowId,
                preimage,
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
            const deposit = await this.escrow.deposits(escrowId);
            return {
                escrowId,
                protectionLevel: deposit.released ? 0 : 1,
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
            const count = await this.escrow.depositCount();
            return count.toString();
        } catch (error) {
            logger.error('Escrow count fetch failed:', error);
            return '0';
        }
    }

    async getEscrowDetails(escrowId) {
        try {
            const escrow = await this.escrow.deposits(escrowId);
            return {
                customer: escrow[0],
                driver: escrow[1],
                amount: ethers.formatEther(escrow[2]),
                released: escrow[3],
                blockMin: escrow[4].toString(),
                secretHash: escrow[5]
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
            protectedEscrows: escrows?.filter(e => e.status === 'pending').length || 0,
            releasedEscrows: escrows?.filter(e => e.status === 'released').length || 0,
            totalBundles: bundles?.length || 0,
            timestamp: new Date().toISOString()
        };
    }
}

export default new MEVService();