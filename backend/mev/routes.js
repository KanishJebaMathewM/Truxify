import express from 'express';
import mevService from './mev.service.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Create commitment
router.post('/mev/commitment', async (req, res) => {
    try {
        const { secret, userId } = req.body;
        if (!secret) {
            return res.status(400).json({
                success: false,
                error: 'secret required'
            });
        }
        
        const result = await mevService.createCommitment(secret, userId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Commitment error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create MEV protected escrow
router.post('/mev/escrow', async (req, res) => {
    try {
        const { driver, amount, secret, userId } = req.body;
        if (!driver || !amount || !secret) {
            return res.status(400).json({
                success: false,
                error: 'driver, amount, and secret required'
            });
        }
        
        const result = await mevService.createEscrow(driver, amount, secret, userId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Escrow creation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Release escrow
router.post('/mev/release/:escrowId', async (req, res) => {
    try {
        const { escrowId } = req.params;
        const { secret, proof } = req.body;
        if (!secret) {
            return res.status(400).json({
                success: false,
                error: 'secret required'
            });
        }
        
        const result = await mevService.releaseEscrow(escrowId, secret, proof);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Release error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Submit Flashbots bundle
router.post('/mev/flashbots/:escrowId', async (req, res) => {
    try {
        const { escrowId } = req.params;
        const { transactions } = req.body;
        if (!transactions) {
            return res.status(400).json({
                success: false,
                error: 'transactions required'
            });
        }
        
        const result = await mevService.submitFlashbotsBundle(escrowId, transactions);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Flashbots error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get MEV protection level
router.get('/mev/protection/:escrowId', async (req, res) => {
    try {
        const { escrowId } = req.params;
        const result = await mevService.getMEVProtectionLevel(escrowId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Protection level error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get escrow details
router.get('/mev/escrow/:escrowId', async (req, res) => {
    try {
        const { escrowId } = req.params;
        const result = await mevService.getEscrowDetails(escrowId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Escrow details error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get MEV stats
router.get('/mev/stats', async (req, res) => {
    try {
        const stats = await mevService.getMEVStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;