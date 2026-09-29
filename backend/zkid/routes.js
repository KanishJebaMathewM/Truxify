import express from 'express';
import zkidService from './zkid.service.js';
import logger from '../api/src/middleware/logger.js';
import { authenticate } from '../api/src/middleware/auth.js';
import { requirePolicy } from '../api/src/middleware/requirePolicy.js';

const router = express.Router();

// Create identity
/**
 * @openapi
 * /api/zkid/identity/create:
 *   post:
 *     tags: [ZK-ID]
 *     summary: Create a ZK-ID identity
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userAddress
 *             properties:
 *               userAddress:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/zkid/identity/create', authenticate, requirePolicy('zkid:create-identity'), async (req, res) => {
    try {
        const { userAddress } = req.body;
        if (!userAddress) {
            return res.status(400).json({ success: false, error: 'userAddress required' });
        }
        const result = await zkidService.createIdentity(userAddress);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Identity creation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Issue credential
/**
 * @openapi
 * /api/zkid/credential/issue:
 *   post:
 *     tags: [ZK-ID]
 *     summary: Issue a credential for an identity
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identityHash
 *               - credentialType
 *             properties:
 *               identityHash:
 *                 type: string
 *               credentialType:
 *                 type: string
 *               schemaHash:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/zkid/credential/issue', authenticate, requirePolicy('zkid:issue-credential'), async (req, res) => {
    try {
        const { identityHash, credentialType, schemaHash } = req.body;
        if (!identityHash || !credentialType) {
            return res.status(400).json({ success: false, error: 'identityHash and credentialType required' });
        }
        const result = await zkidService.issueCredential(identityHash, credentialType, schemaHash);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Credential issuance error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Verify credential
/**
 * @openapi
 * /api/zkid/credential/verify/{credentialHash}:
 *   get:
 *     tags: [ZK-ID]
 *     summary: Verify a credential
 *     parameters:
 *       - in: path
 *         name: credentialHash
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
router.get('/zkid/credential/verify/:credentialHash', authenticate, requirePolicy('zkid:verify-credential'), async (req, res) => {
    try {
        const { credentialHash } = req.params;
        const result = await zkidService.verifyCredential(credentialHash);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Credential verification error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Revoke credential
/**
 * @openapi
 * /api/zkid/credential/revoke:
 *   post:
 *     tags: [ZK-ID]
 *     summary: Revoke a credential
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - credentialHash
 *             properties:
 *               credentialHash:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/zkid/credential/revoke', authenticate, requirePolicy('zkid:revoke-credential'), async (req, res) => {
    try {
        const { credentialHash } = req.body;
        if (!credentialHash) {
            return res.status(400).json({ success: false, error: 'credentialHash required' });
        }
        const result = await zkidService.revokeCredential(credentialHash);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Credential revocation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Issue a fresh replay-resistant verification challenge.
/**
 * @openapi
 * /api/zkid/verification/challenge:
 *   post:
 *     tags: [ZK-ID]
 *     summary: Create a replay-resistant verification challenge
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identityHash
 *               - credentialHash
 *             properties:
 *               identityHash:
 *                 type: string
 *               credentialHash:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/zkid/verification/challenge', authenticate, requirePolicy('zkid:request-verification'), async (req, res) => {
    try {
        const { identityHash, credentialHash } = req.body;
        if (!identityHash || !credentialHash) {
            return res.status(400).json({ success: false, error: 'identityHash and credentialHash required' });
        }
        const challenge = await zkidService.createVerificationChallenge(identityHash, credentialHash);
        res.json({ success: true, data: challenge });
    } catch (error) {
        logger.error('Verification challenge error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Request verification using a previously issued, single-use challenge.
/**
 * @openapi
 * /api/zkid/verification/request:
 *   post:
 *     tags: [ZK-ID]
 *     summary: Submit a ZK-ID verification request
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identityHash
 *               - credentialHash
 *               - proofData
 *               - challenge
 *             properties:
 *               identityHash:
 *                 type: string
 *               credentialHash:
 *                 type: string
 *               proofData:
 *                 type: string
 *               challenge:
 *                 type: object
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/zkid/verification/request', authenticate, requirePolicy('zkid:request-verification'), async (req, res) => {
    try {
        const { identityHash, credentialHash, proofData, challenge } = req.body;
        if (!identityHash || !credentialHash || !proofData || !challenge) {
            return res.status(400).json({
                success: false,
                error: 'identityHash, credentialHash, proofData, and challenge required'
            });
        }

        const result = await zkidService.requestVerification(
            identityHash,
            credentialHash,
            proofData,
            challenge
        );
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Verification request error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create selective disclosure
/**
 * @openapi
 * /api/zkid/disclosure/create:
 *   post:
 *     tags: [ZK-ID]
 *     summary: Create a selective disclosure
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identityHash
 *               - disclosedAttributes
 *               - recipient
 *             properties:
 *               identityHash:
 *                 type: string
 *               disclosedAttributes:
 *                 type: array
 *               recipient:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/zkid/disclosure/create', authenticate, requirePolicy('zkid:create-disclosure'), async (req, res) => {
    try {
        const { identityHash, disclosedAttributes, recipient } = req.body;
        if (!identityHash || !disclosedAttributes || !recipient) {
            return res.status(400).json({
                success: false,
                error: 'identityHash, disclosedAttributes, and recipient required'
            });
        }
        const result = await zkidService.createSelectiveDisclosure(identityHash, disclosedAttributes, recipient);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Disclosure creation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Revoke selective disclosure
/**
 * @openapi
 * /api/zkid/disclosure/revoke:
 *   post:
 *     tags: [ZK-ID]
 *     summary: Revoke a selective disclosure
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - disclosureId
 *             properties:
 *               disclosureId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/zkid/disclosure/revoke', authenticate, requirePolicy('zkid:revoke-disclosure'), async (req, res) => {
    try {
        const { disclosureId } = req.body;
        if (!disclosureId) {
            return res.status(400).json({ success: false, error: 'disclosureId required' });
        }
        const result = await zkidService.revokeSelectiveDisclosure(disclosureId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Disclosure revocation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get identity
/**
 * @openapi
 * /api/zkid/identity/{identityHash}:
 *   get:
 *     tags: [ZK-ID]
 *     summary: Get a ZK-ID identity
 *     parameters:
 *       - in: path
 *         name: identityHash
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
router.get('/zkid/identity/:identityHash', authenticate, requirePolicy('zkid:view-identity'), async (req, res) => {
    try {
        const { identityHash } = req.params;
        const identity = await zkidService.getIdentity(identityHash);
        res.json({ success: true, data: identity });
    } catch (error) {
        logger.error('Identity fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stats
/**
 * @openapi
 * /api/zkid/stats:
 *   get:
 *     tags: [ZK-ID]
 *     summary: Get ZK-ID statistics
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.get('/zkid/stats', authenticate, requirePolicy('zkid:view-stats'), async (req, res) => {
    try {
        const stats = await zkidService.getZKIDStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
