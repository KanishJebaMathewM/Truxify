import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import logger from '../api/src/middleware/logger.js';
import { supabase } from '../api/src/config/db.js';

class DAOService {
    constructor() {
        this.provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        this.daoAddress = process.env.DAO_CONTRACT_ADDRESS;
        this.tokenAddress = process.env.DAO_TOKEN_ADDRESS;

        this.daoABI = [
            'function createProposal(string description, uint256 duration) external returns (uint256)',
            'function voteQuadratic(uint256 proposalId, uint256 votes) external',
            'function proposals(uint256 proposalId) external view returns (string description, uint256 voteCount, uint256 votingDeadline, bool executed)',
            'function votesCast(uint256 proposalId, address voter) external view returns (uint256)',
            'function governanceToken() external view returns (address)',
            'event ProposalCreated(uint256 indexed proposalId, string description, uint256 deadline)',
            'event VotedQuadratic(uint256 indexed proposalId, address indexed voter, uint256 votes, uint256 tokenCost)'
        ];

        this.dao = new ethers.Contract(this.daoAddress, this.daoABI, this.wallet);

        this.proposalDuration = 604800;

        logger.info('✅ DAO Service initialized');
    }

    // ============ Membership ============

    async joinDAO(userAddress) {
        try {
            await this.storeMember(userAddress, null);

            logger.info(`✅ User joined DAO: ${userAddress}`);
            return {
                success: true
            };
        } catch (error) {
            logger.error('Join DAO failed:', error);
            throw error;
        }
    }

    async leaveDAO(userAddress) {
        try {
            await this.updateMemberStatus(userAddress, false, null);

            logger.info(`✅ User left DAO: ${userAddress}`);
            return {
                success: true
            };
        } catch (error) {
            logger.error('Leave DAO failed:', error);
            throw error;
        }
    }

    // ============ Proposals ============

    extractProposalId(receipt) {
        for (const log of receipt.logs || []) {
            try {
                const parsed = this.dao.interface.parseLog(log);
                if (parsed && parsed.name === 'ProposalCreated' && parsed.args.length > 0) {
                    return parsed.args[0].toString();
                }
            } catch {
                // ignore logs that are not part of the DAO ABI
            }
        }
        throw new Error('ProposalCreated event not found in receipt');
    }

    async createProposal(proposalData) {
        try {
            const { title, description, duration } = proposalData;

            const tx = await this.dao.createProposal(
                description || title || '',
                parseInt(duration) || this.proposalDuration,
                { gasLimit: 300000 }
            );
            const receipt = await tx.wait();

            const proposalId = this.extractProposalId(receipt);

            await this.storeProposal({
                ...proposalData,
                proposalId,
                txHash: receipt.hash
            });

            logger.info(`✅ Proposal created: ${proposalId}`);
            return {
                success: true,
                proposalId,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Proposal creation failed:', error);
            throw error;
        }
    }

    async castVote(proposalId, votes, voterAddress, signer) {
        try {
            const parsedVotes = parseInt(votes) || 1;
            const voterContract = signer
                ? new ethers.Contract(this.daoAddress, this.daoABI, signer)
                : this.dao;

            const tx = await voterContract.voteQuadratic(
                proposalId,
                parsedVotes,
                { gasLimit: 200000 }
            );
            const receipt = await tx.wait();

            await this.storeVote({
                proposalId,
                voterAddress,
                votingPower: parsedVotes,
                txHash: receipt.hash
            });

            logger.info(`✅ Vote cast on proposal ${proposalId}`);
            return {
                success: true,
                proposalId,
                votes: parsedVotes,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Vote casting failed:', error);
            throw error;
        }
    }

    async executeProposal(proposalId) {
        try {
            await this.updateProposalStatus(proposalId, 'executed', null);

            logger.info(`✅ Proposal executed: ${proposalId}`);
            return {
                success: true,
                proposalId
            };
        } catch (error) {
            logger.error('Proposal execution failed:', error);
            throw error;
        }
    }

    // ============ View Functions ============

    async getProposal(proposalId) {
        try {
            const proposal = await this.dao.proposals(proposalId);
            return {
                id: proposalId.toString(),
                description: proposal[0],
                voteCount: proposal[1].toString(),
                votingDeadline: proposal[2].toString(),
                executed: proposal[3]
            };
        } catch (error) {
            logger.error('Proposal fetch failed:', error);
            return null;
        }
    }

    async getMember(userAddress) {
        try {
            const { data: member } = await supabase
                .from('dao_members')
                .select('*')
                .eq('user_address', userAddress)
                .maybeSingle();

            if (!member) return null;

            return {
                userAddress: member.user_address,
                isActive: member.is_active,
                joinedAt: member.joined_at
            };
        } catch (error) {
            logger.error('Member fetch failed:', error);
            return null;
        }
    }

    // ============ Database Operations ============

    async storeMember(userAddress, txHash) {
        const { error } = await supabase
            .from('dao_members')
            .insert([{
                user_address: userAddress,
                tx_hash: txHash,
                is_active: true,
                joined_at: new Date().toISOString()
            }]);
        if (error) throw error;
    }

    async updateMemberStatus(userAddress, isActive, txHash) {
        const { error } = await supabase
            .from('dao_members')
            .update({
                is_active: isActive,
                left_tx_hash: txHash,
                left_at: new Date().toISOString()
            })
            .eq('user_address', userAddress);
        if (error) throw error;
    }

    async storeProposal(data) {
        const { error } = await supabase
            .from('dao_proposals')
            .insert([{
                proposal_id: data.proposalId,
                proposer: data.proposer,
                title: data.title,
                description: data.description,
                proposal_type: data.proposalType,
                tx_hash: data.txHash,
                status: 'pending',
                created_at: new Date().toISOString()
            }]);
        if (error) throw error;
    }

    async storeVote(data) {
        const { error } = await supabase
            .from('dao_votes')
            .insert([{
                proposal_id: data.proposalId,
                voter_address: data.voterAddress,
                voting_power: data.votingPower,
                tx_hash: data.txHash,
                created_at: new Date().toISOString()
            }]);
        if (error) throw error;
    }

    async updateProposalStatus(proposalId, status, txHash) {
        const { error } = await supabase
            .from('dao_proposals')
            .update({
                status: status,
                executed_tx_hash: txHash,
                executed_at: new Date().toISOString()
            })
            .eq('proposal_id', proposalId);
        if (error) throw error;
    }

    // ============ Statistics ============

    async getDAOStats() {
        try {
            const { data: members } = await supabase
                .from('dao_members')
                .select('*');

            const { data: proposals } = await supabase
                .from('dao_proposals')
                .select('*');

            const { data: votes } = await supabase
                .from('dao_votes')
                .select('*');

            return {
                totalMembers: members?.length || 0,
                activeMembers: members?.filter(m => m.is_active === true).length || 0,
                totalProposals: proposals?.length || 0,
                pendingProposals: proposals?.filter(p => p.status === 'pending').length || 0,
                executedProposals: proposals?.filter(p => p.status === 'executed').length || 0,
                totalVotes: votes?.length || 0,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Stats fetch failed:', error);
            return null;
        }
    }
}

export default new DAOService();