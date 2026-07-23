import express from 'express';
import swapService from './swap.service.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Create swap
router.post('/swap/create', async (req, res) => {
    try {
        const { counterparty, tokenAddress, amount, secret } = req.body;
        if (!counterparty || !amount) {
            return res.status(400).json({
                success: false,
                error: 'counterparty and amount required'
            });
        }

        const result = await swapService.createSwap(
            counterparty,
            tokenAddress,
            amount,
            secret || swapService.generateSecret()
        );
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Swap creation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Execute swap
router.post('/swap/execute', async (req, res) => {
    try {
        const { swapId, secret } = req.body;
        if (!swapId || !secret) {
            return res.status(400).json({
                success: false,
                error: 'swapId and secret required'
            });
        }

        const result = await swapService.executeSwap(swapId, secret);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Swap execution error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Refund swap
router.post('/swap/refund', async (req, res) => {
    try {
        const { swapId } = req.body;
        if (!swapId) {
            return res.status(400).json({
                success: false,
                error: 'swapId required'
            });
        }

        const result = await swapService.refundSwap(swapId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Swap refund error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create cross-chain swap
router.post('/swap/cross-chain/create', async (req, res) => {
    try {
        const { destChainId, counterparty, tokenAddress, amount, secret } = req.body;
        if (!destChainId || !counterparty || !amount) {
            return res.status(400).json({
                success: false,
                error: 'destChainId, counterparty, and amount required'
            });
        }

        const result = await swapService.createCrossChainSwap(
            destChainId,
            counterparty,
            tokenAddress,
            amount,
            secret || swapService.generateSecret()
        );
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Cross-chain swap creation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Execute cross-chain swap
router.post('/swap/cross-chain/execute', async (req, res) => {
    try {
        const { swapId, secret, proof } = req.body;
        if (!swapId || !secret || !proof) {
            return res.status(400).json({
                success: false,
                error: 'swapId, secret, and proof required'
            });
        }

        const result = await swapService.executeCrossChainSwap(swapId, secret, proof);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Cross-chain swap execution error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Refund cross-chain swap
router.post('/swap/cross-chain/refund', async (req, res) => {
    try {
        const { swapId } = req.body;
        if (!swapId) {
            return res.status(400).json({
                success: false,
                error: 'swapId required'
            });
        }

        const result = await swapService.refundCrossChainSwap(swapId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Cross-chain swap refund error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get swap
router.get('/swap/:swapId', async (req, res) => {
    try {
        const { swapId } = req.params;
        const swap = await swapService.getSwap(swapId);
        res.json({ success: true, data: swap });
    } catch (error) {
        logger.error('Swap fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get cross-chain swap
router.get('/swap/cross-chain/:swapId', async (req, res) => {
    try {
        const { swapId } = req.params;
        const swap = await swapService.getCrossChainSwap(swapId);
        res.json({ success: true, data: swap });
    } catch (error) {
        logger.error('Cross-chain swap fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stats
router.get('/swap/stats', async (req, res) => {
    try {
        const stats = await swapService.getSwapStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;