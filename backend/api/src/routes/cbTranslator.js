import express from 'express';
import { translateVoiceTransmission } from '../services/cbTranslator.js';

const router = express.Router();

router.post('/transmit', (req, res) => {
    try {
        const { channelId, senderId, transcriptText, sourceLanguage, targetLanguage } = req.body;

        if (!transcriptText) {
            return res.status(400).json({ error: 'transcriptText or valid voice payload is required.' });
        }

        const translationPacket = translateVoiceTransmission({
            channelId,
            senderId,
            transcriptText,
            sourceLanguage,
            targetLanguage
        });

        return res.json({
            success: true,
            data: translationPacket
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
