import express from 'express';
import zkpService from './zkp.service.js';
import { zkRatingService } from './rating_proof.js';
import logger from '../api/src/middleware/logger.js';

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
        if (!nullifier || !commitment || !recipient || !amount || !proof) {
            return res.status(400).json({
                success: false,
                error: 'nullifier, commitment, recipient, amount, and proof required'
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

// ============ Zero-Knowledge Rating & Nullifier Replay Defense Routes ============

// Generate ZK 1-of-5 Range Rating Proof
router.post('/zkp/rating/generate', (req, res) => {
    try {
        const { driverAddress, ratingStars, tripSecret, customerId, tripId, blindingFactor } = req.body;
        if (!driverAddress || !ratingStars || !tripSecret || !customerId) {
            return res.status(400).json({
                success: false,
                error: 'driverAddress, ratingStars (1..5), tripSecret, and customerId are required'
            });
        }
        const proofPacket = zkRatingService.generateZkProof(
            driverAddress,
            ratingStars,
            tripSecret,
            customerId,
            tripId,
            blindingFactor
        );
        return res.json({ success: true, data: proofPacket });
    } catch (error) {
        logger.error('ZKP rating proof generate error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// Verify ZK Rating Proof without revealing rating
router.post('/zkp/rating/verify', (req, res) => {
    try {
        const { proofPacket } = req.body;
        if (!proofPacket) {
            return res.status(400).json({ success: false, error: 'proofPacket is required' });
        }
        const result = zkRatingService.verifyZkProof(proofPacket);
        return res.json({ success: result.valid, data: result });
    } catch (error) {
        logger.error('ZKP rating proof verify error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// Submit Verified ZK Rating Proof (Enforces Nullifier Anti-Replay Defense)
router.post('/zkp/rating/submit', (req, res) => {
    try {
        const { proofPacket, actualRatingForLedger } = req.body;
        if (!proofPacket) {
            return res.status(400).json({ success: false, error: 'proofPacket is required' });
        }
        const result = zkRatingService.submitVerifiedRating(proofPacket, actualRatingForLedger);
        return res.json({ success: true, data: result });
    } catch (error) {
        logger.error('ZKP rating proof submit error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// Get Driver Aggregate Anonymous Reputation
router.get('/zkp/rating/driver/:driverAddress', (req, res) => {
    try {
        const { driverAddress } = req.params;
        const rep = zkRatingService.getDriverReputation(driverAddress);
        return res.json({ success: true, data: rep });
    } catch (error) {
        logger.error('ZKP get driver reputation error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// Check if Nullifier has been spent (Anti-Replay)
router.get('/zkp/rating/nullifier/:nullifierHash', (req, res) => {
    try {
        const { nullifierHash } = req.params;
        const spent = zkRatingService.isNullifierSpent(nullifierHash);
        return res.json({ success: true, data: { nullifierHash, spent } });
    } catch (error) {
        logger.error('ZKP check rating nullifier error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

export default router;