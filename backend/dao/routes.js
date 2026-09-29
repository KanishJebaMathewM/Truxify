import express from 'express';
import { ethers } from 'ethers';
import daoService from './dao.service.js';
import logger from '../api/src/middleware/logger.js';
import { authenticate } from '../api/src/middleware/auth.js';
import { requireDaoAuth } from './middleware/daoAuth.js';

const router = express.Router();

// Build a canonical, human-readable message that must be signed by the
// wallet that owns the DAO action. The server recovers the signer and
// rejects any request whose recovered address does not match the claimed
// address, preventing spoofing of membership or votes.
/**
 * Builds the canonical DAO message that wallets sign for authenticated actions.
 * @param {string} action - DAO action identifier.
 * @param {string} payload - Action-specific message payload.
 * @returns {string} Canonical message to sign.
 */
function buildDaoMessage(action, payload) {
    return `Truxify DAO\nAction: ${action}\n${payload}`;
}

/**
 * Recovers the wallet address that signed a DAO action message.
 * @param {string} message - Signed message.
 * @param {string} signature - Wallet signature.
 * @returns {string|null} Recovered signer address, or null for invalid signatures.
 */
function recoverSigner(message, signature) {
    try {
        return ethers.verifyMessage(message, signature);
    } catch {
        return null;
    }
}

// Join DAO — authenticated + wallet-signed to prevent membership spoofing.
/**
 * @openapi
 * /api/dao/join:
 *   post:
 *     tags: [DAO]
 *     summary: Join the DAO
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema:
 *           type: string
 *       - in: header
 *         name: x-dao-signature
 *         required: false
 *         schema:
 *           type: string
 *         description: Delegated wallet signature used when the authenticated JWT wallet differs from the target wallet.
 *       - in: header
 *         name: x-dao-message
 *         required: false
 *         schema:
 *           type: string
 *         description: Canonical DAO action message signed by the delegated wallet.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userAddress
 *               - signature
 *             properties:
 *               userAddress:
 *                 type: string
 *               signature:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Authentication is required.
 *       403:
 *         description: DAO authorization failed.
 *       500:
 *         description: Server error
 */
router.post('/dao/join', requireDaoAuth('join'), authenticate, async (req, res) => {
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
/**
 * @openapi
 * /api/dao/leave:
 *   post:
 *     tags: [DAO]
 *     summary: Leave the DAO
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema:
 *           type: string
 *       - in: header
 *         name: x-dao-signature
 *         required: false
 *         schema:
 *           type: string
 *         description: Delegated wallet signature used when the authenticated JWT wallet differs from the target wallet.
 *       - in: header
 *         name: x-dao-message
 *         required: false
 *         schema:
 *           type: string
 *         description: Canonical DAO action message signed by the delegated wallet.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userAddress
 *               - signature
 *             properties:
 *               userAddress:
 *                 type: string
 *               signature:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Authentication is required.
 *       403:
 *         description: DAO authorization failed.
 *       500:
 *         description: Server error
 */
router.post('/dao/leave', requireDaoAuth('leave'), authenticate, async (req, res) => {
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

// Create proposal — authenticated + wallet-signed; actor bound to the
// recovered signer so the proposer cannot be spoofed via the request body.
/**
 * @openapi
 * /api/dao/proposal/create:
 *   post:
 *     tags: [DAO]
 *     summary: Create a DAO proposal
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema:
 *           type: string
 *       - in: header
 *         name: x-dao-signature
 *         required: false
 *         schema:
 *           type: string
 *         description: Delegated wallet signature used when the authenticated JWT wallet differs from the target wallet.
 *       - in: header
 *         name: x-dao-message
 *         required: false
 *         schema:
 *           type: string
 *         description: Canonical DAO action message signed by the delegated wallet.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - description
 *               - proposer
 *               - signature
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               proposer:
 *                 type: string
 *               signature:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Authentication is required.
 *       403:
 *         description: DAO authorization failed.
 *       500:
 *         description: Server error
 */
router.post('/dao/proposal/create', requireDaoAuth('propose'), authenticate, async (req, res) => {
    try {
        const { title, description, callData, target, value, proposalType, proposer, signature } = req.body;
        if (!title || !description) {
            return res.status(400).json({
                success: false,
                error: 'title and description required'
            });
        }
        if (!proposer || !signature) {
            return res.status(400).json({
                success: false,
                error: 'proposer and signature required'
            });
        }

        const message = buildDaoMessage('proposal', `title: ${title}\ndescription: ${description}`);
        const signer = recoverSigner(message, signature);
        if (!signer || signer.toLowerCase() !== proposer.toLowerCase()) {
            return res.status(401).json({
                success: false,
                error: 'invalid signature: signer does not match userAddress'
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
/**
 * @openapi
 * /api/dao/vote/cast:
 *   post:
 *     tags: [DAO]
 *     summary: Cast a DAO vote
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema:
 *           type: string
 *       - in: header
 *         name: x-dao-signature
 *         required: false
 *         schema:
 *           type: string
 *         description: Delegated wallet signature used when the authenticated JWT wallet differs from the target wallet.
 *       - in: header
 *         name: x-dao-message
 *         required: false
 *         schema:
 *           type: string
 *         description: Canonical DAO action message signed by the delegated wallet.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - proposalId
 *               - voterAddress
 *               - signature
 *             properties:
 *               proposalId:
 *                 type: string
 *               voterAddress:
 *                 type: string
 *               signature:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Authentication is required.
 *       403:
 *         description: DAO authorization failed.
 *       500:
 *         description: Server error
 */
router.post('/dao/vote/cast', requireDaoAuth('vote'), authenticate, async (req, res) => {
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

        const result = await daoService.castVote(req.body.proposalId, req.body.votingPower, req.verifiedSigner, req.body.signer);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Vote casting error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Execute proposal — authenticated + wallet-signed; only the verified
// signer may trigger execution, preventing spoofed execution requests.
/**
 * @openapi
 * /api/dao/proposal/execute:
 *   post:
 *     tags: [DAO]
 *     summary: Execute a DAO proposal
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema:
 *           type: string
 *       - in: header
 *         name: x-dao-signature
 *         required: false
 *         schema:
 *           type: string
 *         description: Delegated wallet signature used when the authenticated JWT wallet differs from the target wallet.
 *       - in: header
 *         name: x-dao-message
 *         required: false
 *         schema:
 *           type: string
 *         description: Canonical DAO action message signed by the delegated wallet.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - proposalId
 *               - executor
 *               - signature
 *             properties:
 *               proposalId:
 *                 type: string
 *               executor:
 *                 type: string
 *               signature:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Authentication is required.
 *       403:
 *         description: DAO authorization failed.
 *       500:
 *         description: Server error
 */
router.post('/dao/proposal/execute', requireDaoAuth('execute'), authenticate, async (req, res) => {
    try {
        const { proposalId, executor, signature } = req.body;
        if (!proposalId) {
            return res.status(400).json({
                success: false,
                error: 'proposalId required'
            });
        }
        if (!executor || !signature) {
            return res.status(400).json({
                success: false,
                error: 'executor and signature required'
            });
        }

        const message = buildDaoMessage('execute', `proposalId: ${proposalId}`);
        const signer = recoverSigner(message, signature);
        if (!signer || signer.toLowerCase() !== executor.toLowerCase()) {
            return res.status(401).json({
                success: false,
                error: 'invalid signature: signer does not match userAddress'
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
/**
 * @openapi
 * /api/dao/proposal/{proposalId}:
 *   get:
 *     tags: [DAO]
 *     summary: Get a DAO proposal
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
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
/**
 * @openapi
 * /api/dao/member/{userAddress}:
 *   get:
 *     tags: [DAO]
 *     summary: Get DAO membership information
 *     parameters:
 *       - in: path
 *         name: userAddress
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
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
/**
 * @openapi
 * /api/dao/stats:
 *   get:
 *     tags: [DAO]
 *     summary: Get DAO statistics
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
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