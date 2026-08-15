import express from 'express';
import { ethers } from 'ethers';
import daoService from './dao.service.js';
import logger from '../api/src/middleware/logger.js';
import { authenticate } from '../api/src/middleware/auth.js';

const router = express.Router();

// Build a canonical, human-readable message that must be signed by the
// wallet that owns the DAO action. The server recovers the signer and
// rejects any request whose recovered address does not match the claimed
// address, preventing spoofing of membership or votes.
function buildDaoMessage(action, payload) {
    return `Truxify DAO\nAction: ${action}\n${payload}`;
}

function recoverSigner(message, signature) {
    try {
        return ethers.verifyMessage(message, signature);
    } catch {
        return null;
    }
}

// Join DAO — authenticated + wallet-signed to prevent membership spoofing.
router.post('/dao/join', authenticate, async (req, res) => {
    try {
        const { userAddress, signature } = req.body;
        if (!userAddress || !signature) {
            return res.status(400).json({
                success: false,
                error: 'userAddress and signature required'
            });
        }

        const message = buildDaoMessage('join', `userAddress: ${userAddress}`);
        const signer = recoverSigner(message, signature);
        if (!signer || signer.toLowerCase() !== userAddress.toLowerCase()) {
            return res.status(401).json({
                success: false,
                error: 'invalid signature: signer does not match userAddress'
            });
        }

        const result = await daoService.joinDAO(userAddress);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Join DAO error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Leave DAO — authenticated + wallet-signed to prevent membership spoofing.
router.post('/dao/leave', authenticate, async (req, res) => {
    try {
        const { userAddress, signature } = req.body;
        if (!userAddress || !signature) {
            return res.status(400).json({
                success: false,
                error: 'userAddress and signature required'
            });
        }

        const message = buildDaoMessage('leave', `userAddress: ${userAddress}`);
        const signer = recoverSigner(message, signature);
        if (!signer || signer.toLowerCase() !== userAddress.toLowerCase()) {
            return res.status(401).json({
                success: false,
                error: 'invalid signature: signer does not match userAddress'
            });
        }

        const result = await daoService.leaveDAO(userAddress);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Leave DAO error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create proposal — authenticated (governance-mutating).
router.post('/dao/proposal/create', authenticate, async (req, res) => {
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

// Cast vote — authenticated + wallet-signed; voting power is derived
// server-side from the voter's on-chain governance-token balance.
router.post('/dao/vote/cast', authenticate, async (req, res) => {
    try {
        const { proposalId, voterAddress, signature } = req.body;
        if (!proposalId || !voterAddress || !signature) {
            return res.status(400).json({
                success: false,
                error: 'proposalId, voterAddress and signature required'
            });
        }

        const message = buildDaoMessage('vote', `proposalId: ${proposalId}\nvoterAddress: ${voterAddress}`);
        const signer = recoverSigner(message, signature);
        if (!signer || signer.toLowerCase() !== voterAddress.toLowerCase()) {
            return res.status(401).json({
                success: false,
                error: 'invalid vote signature: signer does not match voterAddress'
            });
        }

        const result = await daoService.castVote(proposalId, voterAddress);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Vote casting error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Execute proposal — authenticated (governance-mutating).
router.post('/dao/proposal/execute', authenticate, async (req, res) => {
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