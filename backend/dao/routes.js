import express from 'express';
import daoService from './dao.service.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Join DAO
router.post('/dao/join', async (req, res) => {
    try {
        const { userAddress } = req.body;
        if (!userAddress) {
            return res.status(400).json({
                success: false,
                error: 'userAddress required'
            });
        }

        const result = await daoService.joinDAO(userAddress);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Join DAO error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Leave DAO
router.post('/dao/leave', async (req, res) => {
    try {
        const { userAddress } = req.body;
        if (!userAddress) {
            return res.status(400).json({
                success: false,
                error: 'userAddress required'
            });
        }

        const result = await daoService.leaveDAO(userAddress);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Leave DAO error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create proposal
router.post('/dao/proposal/create', async (req, res) => {
    try {
        const { title, description, callData, target, value, proposalType, proposer } = req.body;
        if (!title || !description) {
            return res.status(400).json({
                success: false,
                error: 'title and description required'
            });
        }

        const result = await daoService.createProposal({
            title,
            description,
            callData,
            target,
            value,
            proposalType,
            proposer
        });
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Proposal creation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Cast vote
router.post('/dao/vote/cast', async (req, res) => {
    try {
        const { proposalId, support, votingPower, voterAddress } = req.body;
        if (!proposalId) {
            return res.status(400).json({
                success: false,
                error: 'proposalId required'
            });
        }

        const result = await daoService.castVote(proposalId, support, votingPower, voterAddress);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Vote casting error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Execute proposal
router.post('/dao/proposal/execute', async (req, res) => {
    try {
        const { proposalId } = req.body;
        if (!proposalId) {
            return res.status(400).json({
                success: false,
                error: 'proposalId required'
            });
        }

        const result = await daoService.executeProposal(proposalId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Proposal execution error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Treasury proposal
router.post('/dao/treasury/proposal', async (req, res) => {
    try {
        const { recipient, amount, reason } = req.body;
        if (!recipient || !amount) {
            return res.status(400).json({
                success: false,
                error: 'recipient and amount required'
            });
        }

        const result = await daoService.treasuryProposal(recipient, amount, reason);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Treasury proposal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get proposal
router.get('/dao/proposal/:proposalId', async (req, res) => {
    try {
        const { proposalId } = req.params;
        const proposal = await daoService.getProposal(proposalId);
        res.json({ success: true, data: proposal });
    } catch (error) {
        logger.error('Proposal fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get member
router.get('/dao/member/:userAddress', async (req, res) => {
    try {
        const { userAddress } = req.params;
        const member = await daoService.getMember(userAddress);
        res.json({ success: true, data: member });
    } catch (error) {
        logger.error('Member fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stats
router.get('/dao/stats', async (req, res) => {
    try {
        const stats = await daoService.getDAOStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;