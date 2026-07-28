import express from 'express';
import multer from 'multer';
import voiceAiService from '../services/voice/VoiceAiService.js';
import logger from '../middleware/logger.js';
// Assuming you have an auth middleware, we'll import it, or just leave it open for now
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/voice/' }); // Temporary storage for incoming audio

/**
 * @swagger
 * /api/v1/voice/assistant:
 *   post:
 *     summary: Interact with the Voice AI Assistant
 *     description: Accepts an audio file, transcribes it, queries the LLM, and returns TTS audio.
 *     tags: [Voice]
 */
router.post('/assistant', requireAuth, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file is required' });
    }

    const language = req.body.language || 'en';
    const audioFilePath = req.file.path;

    logger.info(`Received voice query from user ${req.user?.id} in ${language}`);

    const audioStream = await voiceAiService.processVoiceQuery(audioFilePath, language);

    // Set headers to stream audio back to the client
    res.set({
      'Content-Type': 'audio/mpeg',
      'Transfer-Encoding': 'chunked'
    });

    // Pipe the ElevenLabs stream directly to the Express response
    audioStream.pipe(res);

    audioStream.on('error', (err) => {
      logger.error('Error streaming audio back to client:', err);
      res.end();
    });

  } catch (error) {
    logger.error('Voice Assistant Endpoint Error:', error);
    res.status(500).json({ error: 'Failed to process voice query' });
  }
});

export default router;
