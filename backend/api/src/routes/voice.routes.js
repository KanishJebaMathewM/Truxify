import express from 'express';
import multer from 'multer';
import { unlink } from 'fs/promises';
import voiceAiService from '../services/voice/VoiceAiService.js';
import logger from '../middleware/logger.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const VALID_LANGUAGES = ['en', 'hi', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml'];

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
    if (typeof language !== 'string' || !VALID_LANGUAGES.includes(language)) {
      await unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: 'Unsupported language. Supported: ' + VALID_LANGUAGES.join(', ') });
    }

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

    audioStream.on('error', async (err) => {
      logger.error('Error streaming audio back to client:', err);
      res.end();
      await unlink(audioFilePath).catch(() => {});
    });

  } catch (error) {
    logger.error('Voice Assistant Endpoint Error:', error);
    if (req.file) {
      await unlink(req.file.path).catch(() => {});
    }
    res.status(500).json({ error: 'Failed to process voice query' });
  }
});

export default router;
