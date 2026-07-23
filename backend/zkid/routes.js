import express from 'express';
import zkidService from './zkid.service.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Create identity
router.post('/zkid/identity/create', async (req, res) => {
    try {
        const { userAddress } = req.body;
        if (!userAddress) {
            return res.status(400).json({
                success: false,
                error: 'userAddress required'
            });
        }

        const result = await zkidService.createIdentity(userAddress);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Identity creation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Issue credential
router.post('/zkid/credential/issue', async (req, res) => {
    try {
        const { identityHash, credentialType, schemaHash } = req.body;
        if (!identityHash || !credentialType) {
            return res.status(400).json({
                success: false,
                error: 'identityHash and credentialType required'
            });
        }

        const result = await zkidService.issueCredential(identityHash, credentialType, schemaHash);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Credential issuance error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Verify credential
router.get('/zkid/credential/verify/:credentialHash', async (req, res) => {
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
router.post('/zkid/credential/revoke', async (req, res) => {
    try {
        const { credentialHash } = req.body;
        if (!credentialHash) {
            return res.status(400).json({
                success: false,
                error: 'credentialHash required'
            });
        }

        const result = await zkidService.revokeCredential(credentialHash);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Credential revocation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Request verification
router.post('/zkid/verification/request', async (req, res) => {
    try {
        const { identityHash, credentialHash, proofData } = req.body;
        if (!identityHash || !credentialHash) {
            return res.status(400).json({
                success: false,
                error: 'identityHash and credentialHash required'
            });
        }

        const result = await zkidService.requestVerification(identityHash, credentialHash, proofData);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Verification request error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create selective disclosure
router.post('/zkid/disclosure/create', async (req, res) => {
    try {
        const { identityHash, disclosedAttributes, recipient } = req.body;
        if (!identityHash || !disclosedAttributes || !recipient) {
            return res.status(400).json({
                success: false,
                error: 'identityHash, disclosedAttributes, and recipient required'
            });
        }

        const result = await zkidService.createSelectiveDisclosure(
            identityHash,
            disclosedAttributes,
            recipient
        );
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Disclosure creation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Revoke selective disclosure
router.post('/zkid/disclosure/revoke', async (req, res) => {
    try {
        const { disclosureId } = req.body;
        if (!disclosureId) {
            return res.status(400).json({
                success: false,
                error: 'disclosureId required'
            });
        }

        const result = await zkidService.revokeSelectiveDisclosure(disclosureId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Disclosure revocation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get identity
router.get('/zkid/identity/:identityHash', async (req, res) => {
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
router.get('/zkid/stats', async (req, res) => {
    try {
        const stats = await zkidService.getZKIDStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;