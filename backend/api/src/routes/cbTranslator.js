import express from 'express';
import {
    translateVoiceTransmission,
    detectEmergencyDistress,
    verifyVoicePacket,
    CB_CHANNELS,
    SUPPORTED_LANGUAGES
} from '../services/cbTranslator.js';

const router = express.Router();

/**
 * Translates speech transmission and returns signed audio packet.
 * POST /api/cb/transmit
 */
router.post('/transmit', (req, res) => {
    try {
        const { channelId, senderId, transcriptText, sourceLanguage, targetLanguage } = req.body || {};

        if (!transcriptText || typeof transcriptText !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'transcriptText or valid voice payload is required.'
            });
        }

        const translationPacket = translateVoiceTransmission({
            channelId,
            senderId,
            transcriptText,
            sourceLanguage,
            targetLanguage
        });

        return res.status(200).json({
            success: true,
            data: translationPacket
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Emergency broadcast endpoint for Channel 9 distress transmissions.
 * POST /api/cb/emergency-broadcast
 */
router.post('/emergency-broadcast', (req, res) => {
    try {
        const { senderId, transcriptText, locationCoordinates } = req.body || {};

        if (!transcriptText) {
            return res.status(400).json({
                success: false,
                error: 'Emergency transcriptText is required.'
            });
        }

        const distressCheck = detectEmergencyDistress(transcriptText, 'CHANNEL_09');
        const packet = translateVoiceTransmission({
            channelId: 'CHANNEL_09',
            senderId: senderId || 'EMERGENCY_BEACON',
            transcriptText,
            sourceLanguage: 'EN',
            targetLanguage: 'ES'
        });

        return res.status(200).json({
            success: true,
            distressLevel: distressCheck.severity,
            preemptiveOverride: true,
            location: locationCoordinates || null,
            packet
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Cryptographically verifies voice transmission packet against tampering.
 * POST /api/cb/verify-packet
 */
router.post('/verify-packet', (req, res) => {
    try {
        const { packet, signature } = req.body || {};
        const verification = verifyVoicePacket(packet, signature);

        return res.status(200).json({
            success: true,
            ...verification
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Returns supported CB channels and frequency allocation.
 * GET /api/cb/channels
 */
router.get('/channels', (req, res) => {
    return res.status(200).json({
        success: true,
        data: {
            channels: CB_CHANNELS,
            supportedLanguages: SUPPORTED_LANGUAGES
        }
    });
});

export default router;
