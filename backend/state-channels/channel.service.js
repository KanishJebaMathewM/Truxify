import { ethers } from 'ethers';
import logger from '../api/src/middleware/logger.js';
import { channelManager } from './channel_manager.js';

class StateChannelService {
    constructor() {
        this.provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
        this.wallet = new ethers.Wallet(process.env.RELAYER_WALLET_PRIVATE_KEY, this.provider);
        this.channelAddress = process.env.STATE_CHANNEL_ADDRESS;

        this.channelABI = [
            'function openChannel(address userB) external payable returns (bytes32)',
            'function initiateUnilateralExit(bytes32 channelId, uint256 sequence, uint256 balanceA, uint256 balanceB, bytes sig) external',
            'function cooperativeClose(bytes32 channelId, uint256 balanceA, uint256 balanceB, bytes sigA, bytes sigB) external',
            'function finalizeExit(bytes32 channelId) external',
            'function channels(bytes32 channelId) external view returns (address userA, address userB, uint256 balanceA, uint256 balanceB, uint256 sequence, uint256 challengeExpiry, bool isDisputed, bool isClosed)',
            'function channelCounter() external view returns (uint256)',
            'event ChannelOpened(bytes32 indexed channelId, address indexed userA, address indexed userB, uint256 deposit)',
            'event DisputeInitiated(bytes32 indexed channelId, uint256 sequence, uint256 challengeExpiry)',
            'event ChannelClosed(bytes32 indexed channelId, uint256 finalBalanceA, uint256 finalBalanceB)'
        ];

        this.channel = new ethers.Contract(
            this.channelAddress,
            this.channelABI,
            this.wallet
        );

        this.offChainTransactions = [];
        this.channelCache = new Map();

        logger.info('✅ State Channel Service initialized');
    }

    // ============ Channel Operations ============

    async openChannel(participantA, participantB, amount) {
        try {
            const tx = await this.channel.openChannel(participantB, {
                value: ethers.parseEther(amount.toString()),
                gasLimit: 200000
            });
            const receipt = await tx.wait();

            // Parse the bytes32 channel ID from the ChannelOpened event
            const channelId = this._parseChannelOpened(receipt);

            // Track the opened channel in the off-chain ledger
            channelManager.createChannelState(
                channelId,
                this.wallet.address,
                participantB,
                ethers.parseEther(amount.toString()),
                0
            );

            logger.info(`✅ Channel opened: ${channelId}`);
            return {
                success: true,
                channelId,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Channel open failed:', error);
            throw error;
        }
    }

    _parseChannelOpened(receipt) {
        for (const log of receipt.logs) {
            try {
                const parsed = this.channel.interface.parseLog(log);
                if (parsed && parsed.name === 'ChannelOpened') {
                    return parsed.args.channelId;
                }
            } catch (e) {
                continue;
            }
        }
        throw new Error('ChannelOpened event not found in receipt');
    }

    // ============ Dispute ============

    async raiseDispute(channelId, sequence, balanceA, balanceB, signature) {
        try {
            const tx = await this.channel.initiateUnilateralExit(
                channelId,
                sequence,
                balanceA,
                balanceB,
                signature,
                { gasLimit: 200000 }
            );
            const receipt = await tx.wait();

            logger.info(`✅ Dispute raised for channel ${channelId}`);
            return {
                success: true,
                channelId,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Raise dispute failed:', error);
            throw error;
        }
    }

    // ============ Close Channel ============

    async closeChannel(channelId, balanceA, balanceB, signatureA, signatureB) {
        try {
            const tx = await this.channel.cooperativeClose(
                channelId,
                balanceA,
                balanceB,
                signatureA,
                signatureB,
                { gasLimit: 200000 }
            );
            const receipt = await tx.wait();

            logger.info(`✅ Channel closed: ${channelId}`);
            return {
                success: true,
                channelId,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Channel close failed:', error);
            throw error;
        }
    }

    // ============ View Functions ============

    async getChannel(channelId) {
        try {
            const channel = await this.channel.channels(channelId);
            return {
                channelId,
                userA: channel[0],
                userB: channel[1],
                balanceA: channel[2].toString(),
                balanceB: channel[3].toString(),
                sequence: channel[4].toString(),
                challengeExpiry: channel[5].toString(),
                isDisputed: channel[6],
                isClosed: channel[7]
            };
        } catch (error) {
            logger.error('Get channel failed:', error);
            return null;
        }
    }

    // ============ Statistics ============

    async getChannelStats() {
        try {
            const totalChannels = await this.channel.channelCounter();
            return {
                totalChannels: totalChannels.toString(),
                activeChannels: channelManager.activeChannels.size,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Channel stats fetch failed:', error);
            return null;
        }
    }
}

export default new StateChannelService();
