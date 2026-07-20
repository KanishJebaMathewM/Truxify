import { ethers } from 'ethers';
import logger from '../../api/src/middleware/logger.js';
import { supabase } from '../../api/src/config/db.js';

class StateChannelService {
    constructor() {
        this.provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        this.channelAddress = process.env.STATE_CHANNEL_ADDRESS;

        this.channelABI = [
            'function openChannel(address participantB) external returns (uint256)',
            'function fundChannel(uint256 channelId) external payable',
            'function updateState(uint256 channelId, uint256 newBalanceA, uint256 newBalanceB, uint256 nonce, bytes memory signatureA, bytes memory signatureB) external',
            'function closeChannel(uint256 channelId) external',
            'function raiseDispute(uint256 channelId, bytes32 stateHash) external',
            'function batchSettle(uint256[] calldata channelIds) external',
            'function getChannel(uint256 channelId) external view returns (tuple(uint256,address,address,uint256,uint256,uint256,uint256,uint256,uint256,bool,bool,bytes32))',
            'function getChannelStates(uint256 channelId) external view returns (tuple(uint256,uint256,uint256,uint256,bytes32,uint256)[])',
            'function getUserChannels(address user) external view returns (uint256[])',
            'function isChannelActive(uint256 channelId) external view returns (bool)'
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

    async openChannel(participantA, participantB) {
        try {
            const tx = await this.channel.openChannel(participantB, {
                gasLimit: 200000
            });
            const receipt = await tx.wait();

            // Parse channel ID from ChannelOpened event
            const eventLog = receipt.logs.find(log => {
                try {
                    const parsed = this.channel.interface.parseLog(log);
                    return parsed.name === 'ChannelOpened';
                } catch {
                    return false;
                }
            });
            const channelId = eventLog
                ? this.channel.interface.parseLog(eventLog).args[0].toString()
                : (await this.getUserChannels(participantA).then(ch => ch[ch.length - 1]));

            logger.info(`✅ Channel opened: ${channelId}`);
            return {
                success: true,
                channelId,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Channel opening failed:', error);
            throw error;
        }
    }

    async fundChannel(channelId, amount, participant) {
        this.channelCache.delete(channelId);
        try {
            const tx = await this.channel.fundChannel(channelId, {
                value: ethers.parseEther(amount.toString()),
                gasLimit: 100000
            });
            const receipt = await tx.wait();

            logger.info(`✅ Channel ${channelId} funded with ${amount}`);
            return {
                success: true,
                channelId,
                amount,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Channel funding failed:', error);
            throw error;
        }
    }

    async updateState(channelId, balances, nonce, signatures) {
        this.channelCache.delete(channelId);
        try {
            const { balanceA, balanceB } = balances;
            
            const tx = await this.channel.updateState(
                channelId,
                ethers.parseEther(balanceA.toString()),
                ethers.parseEther(balanceB.toString()),
                nonce,
                signatures.signatureA,
                signatures.signatureB,
                { gasLimit: 150000 }
            );
            const receipt = await tx.wait();

            // Store off-chain transaction
            this.offChainTransactions.push({
                channelId,
                balances,
                nonce,
                timestamp: new Date().toISOString(),
                txHash: receipt.hash
            });

            logger.info(`✅ State updated for channel ${channelId}`);
            return {
                success: true,
                channelId,
                nonce,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('State update failed:', error);
            throw error;
        }
    }

    async closeChannel(channelId) {
        this.channelCache.delete(channelId);
        try {
            const tx = await this.channel.closeChannel(channelId, {
                gasLimit: 100000
            });
            const receipt = await tx.wait();

            // Get final balances
            const channel = await this.getChannel(channelId);

            logger.info(`✅ Channel ${channelId} closed`);
            return {
                success: true,
                channelId,
                finalBalanceA: ethers.formatEther(channel.balanceA),
                finalBalanceB: ethers.formatEther(channel.balanceB),
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Channel closure failed:', error);
            throw error;
        }
    }

    // ============ Dispute Resolution ============

    async raiseDispute(channelId, stateHash) {
        this.channelCache.delete(channelId);
        try {
            const tx = await this.channel.raiseDispute(channelId, stateHash, {
                gasLimit: 100000
            });
            const receipt = await tx.wait();

            logger.info(`✅ Dispute raised for channel ${channelId}`);
            return {
                success: true,
                channelId,
                stateHash,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Dispute raising failed:', error);
            throw error;
        }
    }

    // ============ Batch Settlement ============

    async batchSettle(channelIds) {
        channelIds.forEach(id => this.channelCache.delete(id));
        try {
            const tx = await this.channel.batchSettle(channelIds, {
                gasLimit: 300000
            });
            const receipt = await tx.wait();

            logger.info(`✅ Batch settled ${channelIds.length} channels`);
            return {
                success: true,
                count: channelIds.length,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Batch settlement failed:', error);
            throw error;
        }
    }

    // ============ View Functions ============

    async getChannel(channelId) {
        try {
            if (this.channelCache.has(channelId)) {
                return this.channelCache.get(channelId);
            }

            const channel = await this.channel.getChannel(channelId);
            const result = {
                id: channel[0].toString(),
                participantA: channel[1],
                participantB: channel[2],
                balanceA: ethers.formatEther(channel[3]),
                balanceB: ethers.formatEther(channel[4]),
                nonce: channel[5].toString(),
                createdAt: channel[6].toString(),
                lastUpdated: channel[7].toString(),
                challengePeriod: channel[8].toString(),
                isOpen: channel[9],
                isSettled: channel[10],
                latestStateHash: channel[11]
            };

            this.channelCache.set(channelId, result);
            return result;
        } catch (error) {
            logger.error('Channel fetch failed:', error);
            return null;
        }
    }

    async getChannelStates(channelId) {
        try {
            const states = await this.channel.getChannelStates(channelId);
            return states.map(state => ({
                channelId: state[0].toString(),
                balanceA: ethers.formatEther(state[1]),
                balanceB: ethers.formatEther(state[2]),
                nonce: state[3].toString(),
                stateHash: state[4],
                timestamp: state[5].toString()
            }));
        } catch (error) {
            logger.error('Channel states fetch failed:', error);
            return [];
        }
    }

    async getUserChannels(address) {
        try {
            const channels = await this.channel.getUserChannels(address);
            return channels.map(c => c.toString());
        } catch (error) {
            logger.error('User channels fetch failed:', error);
            return [];
        }
    }

    async isChannelActive(channelId) {
        try {
            return await this.channel.isChannelActive(channelId);
        } catch (error) {
            logger.error('Channel active check failed:', error);
            return false;
        }
    }

    // ============ Off-Chain Transaction Management ============

    async getOffChainTransactions(channelId = null) {
        if (channelId) {
            return this.offChainTransactions.filter(t => t.channelId === channelId);
        }
        return this.offChainTransactions;
    }

    async clearOffChainTransactions() {
        this.offChainTransactions = [];
        logger.info('✅ Off-chain transactions cleared');
    }

    // ============ Statistics ============

    async getChannelStats() {
        const channels = [];
        for (const [id, _] of this.channelCache) {
            channels.push(await this.getChannel(id));
        }

        return {
            totalChannels: channels.length,
            openChannels: channels.filter(c => c.isOpen).length,
            settledChannels: channels.filter(c => c.isSettled).length,
            totalValue: channels.reduce((sum, c) => sum + parseFloat(c.balanceA) + parseFloat(c.balanceB), 0),
            offChainTxCount: this.offChainTransactions.length,
            timestamp: new Date().toISOString()
        };
    }
}

export default new StateChannelService();