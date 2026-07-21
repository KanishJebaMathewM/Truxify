import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../api/src/middleware/logger.js';
import { supabase } from '../../api/src/config/db.js';

class DAOService {
    constructor() {
        this.provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        this.daoAddress = process.env.DAO_CONTRACT_ADDRESS;
        this.tokenAddress = process.env.DAO_TOKEN_ADDRESS;

        this.daoABI = [
            'function joinDAO() external',
            'function leaveDAO() external',
            'function createProposal(string memory title, string memory description, bytes memory callData, address target, uint256 value, uint8 proposalType) external returns (uint256)',
            'function castVote(uint256 proposalId, bool support, uint256 votingPower) external',
            'function executeProposal(uint256 proposalId) external',
            'function treasuryProposal(address recipient, uint256 amount, string memory reason) external returns (uint256)',
            'function getProposal(uint256 proposalId) external view returns (tuple(uint256,address,string,string,bytes,address,uint256,uint256,uint256,uint256,uint256,bool,bool,uint8,uint8))',
            'function getMember(address member) external view returns (tuple(address,uint256,uint256,bool,uint256,uint256))',
            'function getTotalProposals() external view returns (uint256)',
            'function getTotalMembers() external view returns (uint256)',
            'function getTreasuryBalance() external view returns (uint256)'
        ];

        this.dao = new ethers.Contract(this.daoAddress, this.daoABI, this.wallet);

        logger.info('✅ DAO Service initialized');
    }

    // ============ Membership ============

    async joinDAO(userAddress) {
        try {
            const tx = await this.dao.joinDAO({ gasLimit: 150000 });
            const receipt = await tx.wait();

            await this.storeMember(userAddress, receipt.hash);

            logger.info(`✅ User joined DAO: ${userAddress}`);
            return {
                success: true,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Join DAO failed:', error);
            throw error;
        }
    }

    async leaveDAO(userAddress) {
        try {
            const tx = await this.dao.leaveDAO({ gasLimit: 100000 });
            const receipt = await tx.wait();

            await this.updateMemberStatus(userAddress, false, receipt.hash);

            logger.info(`✅ User left DAO: ${userAddress}`);
            return {
                success: true,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Leave DAO failed:', error);
            throw error;
        }
    }

    // ============ Proposals ============

    async createProposal(proposalData) {
        try {
            const { title, description, callData, target, value, proposalType } = proposalData;

            const tx = await this.dao.createProposal(
                title,
                description,
                callData || '0x',
                target || ethers.ZeroAddress,
                ethers.parseEther(value?.toString() || '0'),
                proposalType || 0,
                { gasLimit: 300000 }
            );
            const receipt = await tx.wait();

            const proposalId = await this.dao.getTotalProposals();

            await this.storeProposal({
                ...proposalData,
                proposalId: proposalId.toString(),
                txHash: receipt.hash
            });

            logger.info(`✅ Proposal created: ${proposalId}`);
            return {
                success: true,
                proposalId: proposalId.toString(),
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Proposal creation failed:', error);
            throw error;
        }
    }

    async castVote(proposalId, support, votingPower, voterAddress) {
        try {
            const tx = await this.dao.castVote(
                proposalId,
                support,
                ethers.parseEther(votingPower?.toString() || '0'),
                { gasLimit: 150000 }
            );
            const receipt = await tx.wait();

            await this.storeVote({
                proposalId,
                voterAddress,
                support,
                votingPower,
                txHash: receipt.hash
            });

            logger.info(`✅ Vote cast on proposal ${proposalId}`);
            return {
                success: true,
                proposalId,
                support,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Vote casting failed:', error);
            throw error;
        }
    }

    async executeProposal(proposalId) {
        try {
            const tx = await this.dao.executeProposal(proposalId, { gasLimit: 200000 });
            const receipt = await tx.wait();

            await this.updateProposalStatus(proposalId, 'executed', receipt.hash);

            logger.info(`✅ Proposal executed: ${proposalId}`);
            return {
                success: true,
                proposalId,
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Proposal execution failed:', error);
            throw error;
        }
    }

    // ============ Treasury ============

    async treasuryProposal(recipient, amount, reason) {
        try {
            const tx = await this.dao.treasuryProposal(
                recipient,
                ethers.parseEther(amount.toString()),
                reason,
                { gasLimit: 200000 }
            );
            const receipt = await tx.wait();

            const proposalId = await this.dao.getTotalProposals();

            logger.info(`✅ Treasury proposal created: ${proposalId}`);
            return {
                success: true,
                proposalId: proposalId.toString(),
                txHash: receipt.hash
            };
        } catch (error) {
            logger.error('Treasury proposal failed:', error);
            throw error;
        }
    }

    // ============ View Functions ============

    async getProposal(proposalId) {
        try {
            const proposal = await this.dao.getProposal(proposalId);
            return {
                id: proposal[0].toString(),
                proposer: proposal[1],
                title: proposal[2],
                description: proposal[3],
                target: proposal[5],
                value: ethers.formatEther(proposal[6]),
                startTime: proposal[7].toString(),
                endTime: proposal[8].toString(),
                forVotes: proposal[9].toString(),
                againstVotes: proposal[10].toString(),
                abstainVotes: proposal[11].toString(),
                executed: proposal[12],
                passed: proposal[13]
            };
        } catch (error) {
            logger.error('Proposal fetch failed:', error);
            return null;
        }
    }

    async getMember(userAddress) {
        try {
            const member = await this.dao.getMember(userAddress);
            return {
                member: member[0],
                joinedAt: member[1].toString(),
                votingPower: ethers.formatEther(member[2]),
                isActive: member[3],
                proposalsSubmitted: member[4].toString(),
                proposalsVoted: member[5].toString()
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
                support: data.support,
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
            const totalMembers = await this.dao.getTotalMembers();
            const totalProposals = await this.dao.getTotalProposals();
            const treasuryBalance = await this.dao.getTreasuryBalance();

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
                totalMembers: totalMembers.toString(),
                activeMembers: members?.filter(m => m.is_active === true).length || 0,
                totalProposals: totalProposals.toString(),
                pendingProposals: proposals?.filter(p => p.status === 'pending').length || 0,
                executedProposals: proposals?.filter(p => p.status === 'executed').length || 0,
                totalVotes: votes?.length || 0,
                treasuryBalance: ethers.formatEther(treasuryBalance),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Stats fetch failed:', error);
            return null;
        }
    }
}

export default new DAOService();