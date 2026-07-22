import express from 'express';
import tokenService from './token.service.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Create asset
router.post('/token/asset/create', async (req, res) => {
    try {
        const result = await tokenService.createAsset(req.body);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Asset creation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Purchase fraction
router.post('/token/fraction/purchase', async (req, res) => {
    try {
        const { assetId, amount, userAddress } = req.body;
        if (!assetId || !amount || !userAddress) {
            return res.status(400).json({
                success: false,
                error: 'assetId, amount, and userAddress required'
            });
        }
        const result = await tokenService.purchaseFraction(assetId, amount, userAddress);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Fraction purchase error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Sell fraction
router.post('/token/fraction/sell', async (req, res) => {
    try {
        const { assetId, amount, userAddress } = req.body;
        if (!assetId || !amount || !userAddress) {
            return res.status(400).json({
                success: false,
                error: 'assetId, amount, and userAddress required'
            });
        }
        const result = await tokenService.sellFraction(assetId, amount, userAddress);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Fraction sale error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create trade order
router.post('/token/trade/create', async (req, res) => {
    try {
        const { assetId, amount, price, orderType, userAddress } = req.body;
        if (!assetId || !amount || !price || !orderType || !userAddress) {
            return res.status(400).json({
                success: false,
                error: 'assetId, amount, price, orderType, and userAddress required'
            });
        }
        const result = await tokenService.createTradeOrder(
            assetId, amount, price, orderType, userAddress
        );
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Trade order creation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Execute trade order
router.post('/token/trade/execute', async (req, res) => {
    try {
        const { assetId, orderIndex, buyerAddress } = req.body;
        if (!assetId || orderIndex === undefined || !buyerAddress) {
            return res.status(400).json({
                success: false,
                error: 'assetId, orderIndex, and buyerAddress required'
            });
        }
        const result = await tokenService.executeTradeOrder(assetId, orderIndex, buyerAddress);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Trade order execution error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get asset
router.get('/token/asset/:assetId', async (req, res) => {
    try {
        const { assetId } = req.params;
        const asset = await tokenService.getAsset(assetId);
        res.json({ success: true, data: asset });
    } catch (error) {
        logger.error('Asset fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get fractional ownership
router.get('/token/ownership/:assetId/:userAddress', async (req, res) => {
    try {
        const { assetId, userAddress } = req.params;
        const ownership = await tokenService.getFractionalOwnership(assetId, userAddress);
        res.json({ success: true, data: ownership });
    } catch (error) {
        logger.error('Ownership fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stats
router.get('/token/stats', async (req, res) => {
    try {
        const stats = await tokenService.getStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;