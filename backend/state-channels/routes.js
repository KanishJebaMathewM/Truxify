import express from 'express';
import channelService from './channel.service.js';
import logger from '../api/src/middleware/logger.js';

const router = express.Router();

// Open channel
router.post('/channels/open', async (req, res) => {
    try {
        const { participantA, participantB, amount } = req.body;
        if (!participantA || !participantB || !amount) {
            return res.status(400).json({
                success: false,
                error: 'participantA, participantB, and amount required'
            });
        }

        const result = await channelService.openChannel(participantA, participantB, amount);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Open channel error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Close channel
router.post('/channels/close/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;
        const { balanceA, balanceB, signatureA, signatureB } = req.body;
        if (balanceA === undefined || balanceB === undefined || !signatureA || !signatureB) {
            return res.status(400).json({
                success: false,
                error: 'balanceA, balanceB, signatureA, and signatureB required'
            });
        }

        const result = await channelService.closeChannel(channelId, balanceA, balanceB, signatureA, signatureB);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Close channel error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Raise dispute
router.post('/channels/dispute/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;
        const { sequence, balanceA, balanceB, signature } = req.body;
        if (sequence === undefined || balanceA === undefined || balanceB === undefined || !signature) {
            return res.status(400).json({
                success: false,
                error: 'sequence, balanceA, balanceB, and signature required'
            });
        }

        const result = await channelService.raiseDispute(channelId, sequence, balanceA, balanceB, signature);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Raise dispute error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get channel
router.get('/channels/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;
        const channel = await channelService.getChannel(channelId);
        res.json({ success: true, data: channel });
    } catch (error) {
        logger.error('Get channel error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get channel stats
router.get('/channels/stats', async (req, res) => {
    try {
        const stats = await channelService.getChannelStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Get stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;