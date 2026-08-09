import express from 'express';
import multer from 'multer';
import voiceAiService from '../services/voice/VoiceAiService.js';
import logger from '../middleware/logger.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();
const upload = multer({
  dest: 'uploads/voice/', // Temporary storage for incoming audio
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio is allowed.'));
    }
  }
});
/**
 * @swagger
 * /api/v1/voice/assistant:
 *   post:
 *     summary: Interact with the Voice AI Assistant
 *     description: Accepts an audio file, transcribes it, queries the LLM, and returns TTS audio.
 *     tags: [Voice]
 */
router.post('/assistant', authenticate, userLimiter, upload.single('audio'), async (req, res) => {
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
