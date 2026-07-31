import { ethers } from 'ethers';
import { randomUUID } from 'crypto';
import logger from '../api/src/middleware/logger.js';
import { supabase } from '../api/src/config/db.js';

class StateChannelService {
    constructor() {
        this.provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
        this.wallet = new ethers.Wallet(process.env.RELAYER_WALLET_PRIVATE_KEY, this.provider);
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
            const tx = await this.channel.openChannel(participantA, participantB, {
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
                : (await this.getUserChannels(participantA).then(ch => {
                .catch(err=>console.error(err))