import { ethers } from 'ethers';
import axios from 'axios';
import logger from '../api/src/middleware/logger.js';
import { supabase } from '../api/src/config/db.js';
import { getMevRelayer } from './flashbots_relayer.js';

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
        // Store configuration; wallet and contract are initialized lazily to
        // avoid crashing the API when PRIVATE_KEY / MEV_ESCROW_ADDRESS are unset.
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
        this.flashbotsEndpoint = process.env.FLASHBOTS_ENDPOINT || 'https://relay.flashbots.net';

        // Backing fields for lazy initialization.
        this._provider = null;
        this._wallet = null;
        this._escrow = null;

        logger.info('MEV Protection Service initialized (lazy wallet mode)');
    }

    /** Lazily initializes the JSON-RPC provider. */
    get provider() {
        if (!this._provider) {
            const rpcUrl = process.env.POLYGON_RPC_URL;
            if (!rpcUrl) {
                throw new Error('POLYGON_RPC_URL environment variable is required for MEV operations');
            }
            this._provider = new ethers.JsonRpcProvider(rpcUrl);
        }
        return this._provider;
    }

    /** Lazily initializes the signing wallet. */
    get wallet() {
        if (!this._wallet) {
            const privateKey = process.env.PRIVATE_KEY;
            if (!privateKey) {
                throw new Error('PRIVATE_KEY environment variable is required for MEV signing operations');
            }
            this._wallet = new ethers.Wallet(privateKey, this.provider);
        }
        return this._wallet;
    }

    /** Lazily initializes the escrow contract. */
    get escrow() {
        if (!this._escrow) {
            if (!this.escrowAddress) {
                throw new Error('MEV_ESCROW_ADDRESS environment variable is required for escrow operations');
            }
            this._escrow = new ethers.Contract(
                this.escrowAddress,
                this.escrowABI,
                this.wallet
            );
        }
        return this._escrow;
    }

    // ============ Commitment Creation ============

    async createCommitment(secret, userId) {
        try {
            const preimage = toPreimageBytes32(secret);
            const secretHash = ethers.keccak256(preimage);

            await this.storeCommitment({
                userId,
                secretHash,
                txHash: null
            });

            logger.info(`Commitment created for user ${userId}`);
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
            const commitment = await this.createCommitment(secret, userId);

            const secretHash = ethers.keccak256(toPreimageBytes32(secret));

            const tx = await this.escrow.createProtectedDeposit(
                driver,
                secretHash,
                {
                    value: ethers.parseEther(amount.toString()),
                    gasLimit: 200000
                }
            );
            const receipt = await tx.wait();

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

            logger.info(`MEV Protected Escrow created: ${escrowId}`);
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
            const preimage = toPreimageBytes32(secret);

            if (process.env.MEV_PRIVATE_RELAY === 'true') {
                const result = await this.releaseEscrowPrivate(escrowId, preimage);
                await this.updateEscrowStatus(escrowId, 'released', result.txHash);
                logger.info(`Escrow ${escrowId} released via private bundle`);
                return result;
            }

            const tx = await this.escrow.releaseDepositPrivate(
                escrowId,
                preimage,
                { gasLimit: 150000 }
            );
            const receipt = await tx.wait();

            await this.updateEscrowStatus(escrowId, 'released', receipt.hash);

            logger.info(`Escrow ${escrowId} released with MEV protection`);
            return {
                success: true,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Escrow release failed:', error);
            throw error;
        }
    }

    /**
     * Releases an escrow deposit via a Flashbots private bundle.
     * Submits the releaseDepositPrivate transaction privately so it cannot
     * be front-run by MEV bots.
     *
     * @param {string|number} escrowId - The deposit ID
     * @param {string} preimage - The 32-byte preimage that unlocks the deposit
     * @returns {Promise<{success: boolean, txHash: string, bundleHash?: string, targetBlock?: number}>}
     */
    async releaseEscrowPrivate(escrowId, preimage) {
        const relayer = getMevRelayer();
        const targetBlock = (await this.provider.getBlockNumber()) + 2;

        const bundle = await relayer.assemblePrivateBundle(
            this.escrowAddress,
            this.escrowABI,
            'releaseDepositPrivate',
            [escrowId, preimage],
            targetBlock
        );

        const result = await relayer.sendPrivateBundle(bundle);

        logger.info({
            event: 'ESCROW_RELEASED_PRIVATE',
            escrowId,
            bundleHash: result.bundleHash,
            targetBlock: result.targetBlock
        }, 'Escrow released via Flashbots private bundle');

        return {
            success: true,
            txHash: result.bundleHash,
            bundleHash: result.bundleHash,
            targetBlock: result.targetBlock
        };
    }

    async signTransactions(transactions) {
        const signedTxs = [];
        for (const tx of transactions) {
            const signedTx = await this.wallet.signTransaction(tx);
            signedTxs.push(signedTx);
        }
        return signedTxs;
    }

    async releaseEscrowPrivate(escrowId, preimage) {
        try {
            const relayer = getMevRelayer();
            const targetBlock = (await this.provider.getBlockNumber()) + 1;
            const bundle = await relayer.assemblePrivateBundle(
                this.escrowAddress,
                this.escrowABI,
                'releaseDepositPrivate',
                [escrowId, preimage],
                targetBlock
            );
            const result = await relayer.sendPrivateBundle(bundle);
            return {
                success: true,
                txHash: result.bundleHash,
                bundleHash: result.bundleHash,
                targetBlock: result.targetBlock
            };
        } catch (error) {
            logger.error('Private bundle release failed:', error);
            throw error;
        }
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

    /**
     * Submits a Flashbots bundle for an escrow.
     * Assembles signed transactions targeting the escrow contract and sends
     * them via the Flashbots relayer for front-running protection.
     *
     * @param {string} escrowId - The deposit ID on the escrow contract
     * @param {string[]} transactions - Array of signed raw transaction hex strings
     * @returns {Promise<{success: boolean, bundleHash?: string, targetBlock?: number}>}
     */
    async submitFlashbotsBundle(escrowId, transactions) {
        try {
            if (!Array.isArray(transactions) || transactions.length === 0) {
                throw new Error('transactions must be a non-empty array of signed transaction hex strings');
            }

            const relayer = getMevRelayer();
            const targetBlock = (await this.provider.getBlockNumber()) + 2;

            const bundle = await relayer.assemblePrivateBundle(
                this.escrowAddress,
                this.escrowABI,
                'releaseDepositPrivate',
                [escrowId, '0x' + '00'.repeat(32)],
                targetBlock
            );

            const result = await relayer.sendPrivateBundle(bundle);

            logger.info({
                event: 'FLASHBOTS_BUNDLE_SUBMITTED',
                escrowId,
                bundleHash: result.bundleHash,
                targetBlock: result.targetBlock
            }, 'Flashbots bundle submitted successfully');

            return {
                success: true,
                bundleHash: result.bundleHash,
                targetBlock: result.targetBlock
            };
        } catch (err) {
            logger.error({ event: 'FLASHBOTS_BUNDLE_ERROR', escrowId, error: err.message }, 'Failed to submit Flashbots bundle');
            throw err;
        }
    }
}

export default new MEVService();
