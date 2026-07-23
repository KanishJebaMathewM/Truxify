import express from 'express';
import didService from './did.service.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

router.post('/did/create', async (req, res) => {
    try {
        const { userAddress } = req.body;
        if (!userAddress) return res.status(400).json({ success: false, error: 'userAddress required' });

        const result = await didService.createDID(userAddress);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('DID creation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/did/credential/issue', async (req, res) => {
    try {
        const { subject, credentialType, schema, validUntil } = req.body;
        if (!subject || !credentialType) {
            return res.status(400).json({ success: false, error: 'subject and credentialType required' });
        }

        const result = await didService.issueCredential(subject, credentialType, schema || {}, validUntil);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Credential issuance error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/did/credential/verify/:credentialId', async (req, res) => {
    try {
        const { credentialId } = req.params;
        const result = await didService.verifyCredential(credentialId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Credential verification error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/did/credential/revoke', async (req, res) => {
    try {
        const { credentialId } = req.body;
        if (!credentialId) return res.status(400).json({ success: false, error: 'credentialId required' });

        const result = await didService.revokeCredential(credentialId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Credential revocation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/did/:did', async (req, res) => {
    try {
        const { did } = req.params;
        const result = await didService.getDID(did);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('DID fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/did/wallet/:address', async (req, res) => {
    try {
        const { address } = req.params;
        const result = await didService.getWallet(address);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Wallet fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/did/credentials/:address', async (req, res) => {
    try {
        const { address } = req.params;
        const result = await didService.getCredentials(address);
        res.json({ success: true, data: result, count: result.length });
    } catch (error) {
        logger.error('Credentials fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/did/stats', async (req, res) => {
    try {
        const stats = await didService.getDIDStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Stats fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;