import express from 'express';
import zkpService from './zkp.service.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Generate SNARK proof
router.post('/zkp/snark/generate', async (req, res) => {
    try {
        const { data } = req.body;
        const result = await zkpService.generateSNARKProof(data);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('SNARK generate error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Verify SNARK proof
router.post('/zkp/snark/verify', async (req, res) => {
    try {
        const { proof } = req.body;
        if (!proof) {
            return res.status(400).json({ success: false, error: 'proof required' });
        }
        const result = await zkpService.verifySNARK(proof);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('SNARK verify error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Process private transaction
router.post('/zkp/transaction/private', async (req, res) => {
    try {
        const { nullifier, commitment, recipient, amount, proof } = req.body;
        if (!nullifier || !recipient || !amount) {
            return res.status(400).json({
                success: false,
                error: 'nullifier, recipient, and amount required'
            });
        }
        const result = await zkpService.processPrivateTransaction({
            nullifier,
            commitment,
            recipient,
            amount,
            proof
        });
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Private transaction error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Generate STARK proof
router.post('/zkp/stark/generate', async (req, res) => {
    try {
        const { data } = req.body;
        const result = await zkpService.generateSTARKProof(data);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('STARK generate error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Verify STARK proof
router.post('/zkp/stark/verify', async (req, res) => {
    try {
        const { proof, publicInputs } = req.body;
        if (!proof || !publicInputs) {
            return res.status(400).json({
                success: false,
                error: 'proof and publicInputs required'
            });
        }
        const result = await zkpService.verifySTARK(proof, publicInputs);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('STARK verify error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create private transaction
router.post('/zkp/transaction/create', async (req, res) => {
    try {
        const { recipient, amount, encryptedData } = req.body;
        if (!recipient || !amount) {
            return res.status(400).json({
                success: false,
                error: 'recipient and amount required'
            });
        }
        const result = await zkpService.createPrivateTransaction(recipient, amount, encryptedData);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Create transaction error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Merkle root
router.get('/zkp/merkle-root', async (req, res) => {
    try {
        const root = await zkpService.getMerkleRoot();
        res.json({ success: true, data: { merkleRoot: root } });
    } catch (error) {
        logger.error('Merkle root error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check nullifier
router.get('/zkp/nullifier/:nullifier', async (req, res) => {
    try {
        const { nullifier } = req.params;
        const used = await zkpService.isNullifierUsed(nullifier);
        res.json({ success: true, data: { nullifier, used } });
    } catch (error) {
        logger.error('Nullifier check error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stats
router.get('/zkp/stats', async (req, res) => {
    try {
        const stats = await zkpService.getZKPStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;