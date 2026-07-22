import express from 'express';
import channelService from './channel.service.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Open channel
router.post('/channels/open', async (req, res) => {
    try {
        const { participantA, participantB } = req.body;
        if (!participantA || !participantB) {
            return res.status(400).json({
                success: false,
                error: 'participantA and participantB required'
            });
        }

        const result = await channelService.openChannel(participantA, participantB);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Open channel error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Fund channel
router.post('/channels/fund/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;
        const { amount, participant } = req.body;
        if (!amount || !participant) {
            return res.status(400).json({
                success: false,
                error: 'amount and participant required'
            });
        }

        const result = await channelService.fundChannel(channelId, amount, participant);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Fund channel error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update state
router.post('/channels/update/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;
        const { balances, nonce, signatures } = req.body;
        if (!balances || nonce === undefined || !signatures) {
            return res.status(400).json({
                success: false,
                error: 'balances, nonce, and signatures required'
            });
        }

        const result = await channelService.updateState(channelId, balances, nonce, signatures);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Update state error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Close channel
router.post('/channels/close/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;
        const result = await channelService.closeChannel(channelId);
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
        const { stateHash } = req.body;
        if (!stateHash) {
            return res.status(400).json({
                success: false,
                error: 'stateHash required'
            });
        }

        const result = await channelService.raiseDispute(channelId, stateHash);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Raise dispute error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Batch settle
router.post('/channels/batch-settle', async (req, res) => {
    try {
        const { channelIds } = req.body;
        if (!channelIds || !Array.isArray(channelIds)) {
            return res.status(400).json({
                success: false,
                error: 'channelIds array required'
            });
        }

        const result = await channelService.batchSettle(channelIds);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Batch settle error:', error);
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

// Get channel states
router.get('/channels/:channelId/states', async (req, res) => {
    try {
        const { channelId } = req.params;
        const states = await channelService.getChannelStates(channelId);
        res.json({ success: true, data: states });
    } catch (error) {
        logger.error('Get channel states error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get user channels
router.get('/channels/user/:address', async (req, res) => {
    try {
        const { address } = req.params;
        const channels = await channelService.getUserChannels(address);
        res.json({ success: true, data: channels });
    } catch (error) {
        logger.error('Get user channels error:', error);
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